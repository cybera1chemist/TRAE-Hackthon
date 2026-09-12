import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIError, type AIProvider } from '@/infra/ai/types'
import { AIProviderRouter, normalizeError } from '@/infra/ai/provider'

/* 测试专用：假实现返回 any 以适配挂起/抛错等各种形态 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type FakeImpl = Partial<Record<keyof AIProvider, (signal?: AbortSignal) => Promise<any>>>

/** 可控假 adapter：记录调用次数，可切换返回/抛错/挂起 */
function fakeAdapter(impl: FakeImpl) {
  const calls = vi.fn()
  return {
    calls,
    provider: {
      recognizeDish: vi.fn(async (_req, signal) => {
        calls()
        return impl.recognizeDish ? impl.recognizeDish(signal) : { ok: true }
      }),
      scanMenu: vi.fn(async () => impl.scanMenu?.() ?? {}),
      extractTags: vi.fn(async () => impl.extractTags?.() ?? {}),
      generateCardCopy: vi.fn(async () => impl.generateCardCopy?.() ?? { lines: [] }),
    } as unknown as AIProvider,
  }
}

const noDelay = async () => {}

describe('AIProviderRouter', () => {
  afterEach(() => vi.useRealTimers())

  it('成功结果透传，熔断记录成功', async () => {
    const { provider } = fakeAdapter({
      recognizeDish: async () => ({
        requestId: 'r1',
        results: [],
        model: { vendor: 'v', version: '1' },
      }),
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    const resp = await router.recognizeDish({ images: [] })
    expect(resp.requestId).toBe('r1')
    expect(provider.recognizeDish).toHaveBeenCalledTimes(1)
  })

  it('AUTH/BAD_OUTPUT 等非重试错误只调用 1 次并原样归一', async () => {
    const { provider } = fakeAdapter({
      recognizeDish: async () => {
        throw new AIError('AUTH', 'bad key')
      },
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    await expect(router.recognizeDish({ images: [] })).rejects.toMatchObject({
      code: 'AUTH',
      retriable: false,
    })
    expect(provider.recognizeDish).toHaveBeenCalledTimes(1)
  })

  it('NETWORK 错误自动重试 1 次；第二次成功则返回', async () => {
    let first = true
    const { provider } = fakeAdapter({
      recognizeDish: async () => {
        if (first) {
          first = false
          throw new AIError('NETWORK', 'boom')
        }
        return { requestId: 'r2', results: [], model: { vendor: 'v', version: '1' } }
      },
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    const resp = await router.recognizeDish({ images: [] })
    expect(resp.requestId).toBe('r2')
    expect(provider.recognizeDish).toHaveBeenCalledTimes(2)
  })

  it('NETWORK 重试仍失败：只调用 2 次且错误归一', async () => {
    const { provider } = fakeAdapter({
      recognizeDish: async () => {
        throw new TypeError('fetch failed')
      },
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    await expect(router.recognizeDish({ images: [] })).rejects.toMatchObject({ code: 'NETWORK' })
    expect(provider.recognizeDish).toHaveBeenCalledTimes(2)
  })

  it('超过 15s 未响应 → TIMEOUT（AbortSignal 传给 adapter）', async () => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    const { provider } = fakeAdapter({
      recognizeDish: (signal) => {
        receivedSignal = signal
        // 监听 abort：router 超时后中止 signal，本 promise 随之 reject
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')))
        })
      },
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    const p = router.recognizeDish({ images: [] })
    // 先挂 rejection 处理器，再推进假时钟，避免 Node 报 unhandledRejection
    const asserted = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' })
    // TIMEOUT 可重试：首轮 15s + 重试轮 15s = 30s 后终态
    await vi.advanceTimersByTimeAsync(30_000)
    await asserted
    expect(receivedSignal?.aborted).toBe(true)
    expect(provider.recognizeDish).toHaveBeenCalledTimes(2)
  })

  it('用户外部 abort 立即中断并归一为 TIMEOUT', async () => {
    const ac = new AbortController()
    const { provider } = fakeAdapter({
      recognizeDish: (signal) =>
        new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('user abort', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () =>
            reject(new DOMException('user abort', 'AbortError')),
          )
        }),
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    const p = router.recognizeDish({ images: [] }, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ code: 'TIMEOUT' })
    // 第二轮重试时外部信号已 aborted，withTimeout 快速失败，不再调用 adapter
    expect(provider.recognizeDish).toHaveBeenCalledTimes(1)
  })

  it('熔断：连续 5 次失败后第 6 次直接短路 RATE_LIMITED，不再调 adapter', async () => {
    const { provider } = fakeAdapter({
      recognizeDish: async () => {
        throw new AIError('AUTH', 'bad key') // 非重试，每次算 1 次失败
      },
    })
    const router = new AIProviderRouter({ adapter: provider, retryDelay: noDelay })
    for (let i = 0; i < 5; i++) {
      await expect(router.recognizeDish({ images: [] })).rejects.toMatchObject({ code: 'AUTH' })
    }
    await expect(router.recognizeDish({ images: [] })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: /Circuit breaker open/,
    })
    expect(provider.recognizeDish).toHaveBeenCalledTimes(5)
  })
})

describe('normalizeError', () => {
  it('HTTP 401/403 → AUTH，429 → RATE_LIMITED，500 → NETWORK，400 → UNKNOWN', () => {
    expect(normalizeError({ status: 401 }).code).toBe('AUTH')
    expect(normalizeError({ status: 403 }).code).toBe('AUTH')
    expect(normalizeError({ status: 429 }).code).toBe('RATE_LIMITED')
    expect(normalizeError({ status: 502 }).code).toBe('NETWORK')
    expect(normalizeError({ status: 400 }).code).toBe('UNKNOWN')
  })

  it('ZodError → BAD_OUTPUT；TypeError → NETWORK；AIError 原样返回', () => {
    const zod = new Error('bad')
    zod.name = 'ZodError'
    expect(normalizeError(zod).code).toBe('BAD_OUTPUT')
    expect(normalizeError(new TypeError('Failed to fetch')).code).toBe('NETWORK')
    const ae = new AIError('NO_FOOD')
    expect(normalizeError(ae)).toBe(ae)
  })
})
