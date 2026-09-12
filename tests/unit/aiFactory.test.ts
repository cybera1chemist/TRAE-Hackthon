import { describe, expect, it, vi } from 'vitest'
import { createAIProvider } from '@/infra/ai/factory'
import { AIProviderRouter } from '@/infra/ai/provider'

function vendorEnvelope(content: unknown) {
  return {
    id: 'chatcmpl-f-1',
    model: 'qwen-vl-max',
    choices: [{ message: { content: JSON.stringify(content) } }],
  }
}

describe('createAIProvider 工厂（T2-01）', () => {
  it('默认/显式 mock：返回 mock 夹具（不经 Router，无重试副作用）', async () => {
    const ai = createAIProvider()
    const resp = await ai.recognizeDish({ images: [] })
    expect(resp.requestId).toBe('req_mock_01')
    expect(ai).not.toBeInstanceOf(AIProviderRouter)
  })

  it("mode='bff'：外套 Router，经注入的 fetch 打到 BFF", async () => {
    const content = {
      results: [
        {
          imageIndex: 0,
          imageQuality: { blur: false, hasFood: true },
          dishes: [
            {
              name: '回锅肉',
              confidence: 0.8,
              candidates: ['回锅肉'],
              bbox: [1, 2, 3, 4],
            },
          ],
        },
      ],
    }
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(vendorEnvelope(content)),
      }
    }) as unknown as typeof fetch

    const ai = createAIProvider({
      mode: 'bff',
      baseUrl: '/api/ai',
      fetchImpl,
      router: { disableCircuitBreaker: true },
    })
    expect(ai).toBeInstanceOf(AIProviderRouter)
    const resp = await ai.recognizeDish({ images: [] })
    expect(resp.results[0]?.dishes[0]?.name).toBe('回锅肉')
    expect(calls[0]).toBe('/api/ai/recognize')
  })

  it("mode='direct' 无 apiKey 直接抛错（防止误用导致 Key 缺失报错不透明）", () => {
    expect(() => createAIProvider({ mode: 'direct' })).toThrow(/apiKey|direct/)
  })

  it("mode='direct' + apiKey：构造成功并直连供应商", async () => {
    const content = {
      results: [
        {
          imageIndex: 0,
          imageQuality: { blur: false, hasFood: true },
          dishes: [],
        },
      ],
    }
    const calls: Array<{ url: string; auth?: string }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      calls.push({ url, auth: headers.authorization })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(vendorEnvelope(content)),
      }
    }) as unknown as typeof fetch

    const ai = createAIProvider({
      mode: 'direct',
      apiKey: 'sk-secret',
      baseUrl: 'https://dashscope.test/v1',
      fetchImpl,
      router: { disableCircuitBreaker: true },
    })
    await ai.recognizeDish({ images: [] })
    expect(calls[0]?.url).toBe('https://dashscope.test/v1/chat/completions')
    expect(calls[0]?.auth).toBe('Bearer sk-secret')
  })

  it('未知 mode 抛错', () => {
    expect(() => createAIProvider({ mode: 'weird' as never })).toThrow(/unknown VITE_AI_MODE/)
  })
})
