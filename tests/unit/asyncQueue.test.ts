import { describe, expect, it, vi } from 'vitest'
import {
  AsyncQueue,
  InMemoryJobStore,
  type JobHandlerRegistry,
  type JobRecord,
} from '@/infra/queue'

/** 手动时钟：避免假定时器，直接推进 runAt 判定 */
function clock() {
  let t = 1_000_000
  return {
    now: () => t,
    advance(ms: number) {
      t += ms
    },
  }
}

const makeQueue = (handlers: JobHandlerRegistry, c = clock()) => {
  const store = new InMemoryJobStore()
  const queue = new AsyncQueue({ store, handlers, now: c.now, pollIntervalMs: 999_999 })
  return { store, queue, c }
}

describe('AsyncQueue（T2-05）', () => {
  it('入队后立即执行：pending → done，attempts=1', async () => {
    const handler = vi.fn(async (_job: JobRecord) => {})
    const { store, queue } = makeQueue({ extractTags: handler })
    const id = await queue.enqueue('extractTags', { logId: 'l1' })
    await queue.waitForIdle()
    const done = await store.get(id)
    expect(done?.status).toBe('done')
    expect(done?.attempts).toBe(1)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]![0].payload).toEqual({ logId: 'l1' })
  })

  it('首次失败 → retrying 且 runAt=now+2s；时钟推进后再次执行成功', async () => {
    let ok = false
    const handler = vi.fn(async () => {
      if (!ok) throw new Error('ai down')
    })
    const c = clock()
    const { store, queue } = makeQueue({ extractTags: handler }, c)
    const id = await queue.enqueue('extractTags')
    await queue.waitForIdle()
    let j = await store.get(id)
    expect(j?.status).toBe('retrying')
    expect(j?.attempts).toBe(1)
    expect(j?.runAt).toBe(c.now() + 2_000)

    // 未到时间不执行
    c.advance(1_999)
    await queue.tick()
    expect(handler).toHaveBeenCalledTimes(1)

    // 到点执行成功
    ok = true
    c.advance(1)
    await queue.tick()
    j = await store.get(id)
    expect(j?.status).toBe('done')
    expect(j?.attempts).toBe(2)
  })

  it('退避序列 2s/5s/15s；3 次失败后终态 failed', async () => {
    const handler = vi.fn(async () => {
      throw new Error('always fail')
    })
    const c = clock()
    const { store, queue } = makeQueue({ extractTags: handler }, c)
    const id = await queue.enqueue('extractTags')
    await queue.waitForIdle()

    c.advance(2_000)
    await queue.tick()
    let j = await store.get(id)
    expect(j?.status).toBe('retrying')
    expect(j?.runAt).toBe(1_000_000 + 2_000 + 5_000)

    c.advance(5_000)
    await queue.tick()
    j = await store.get(id)
    expect(j?.status).toBe('failed')
    expect(j?.attempts).toBe(3)
    expect(j?.lastError).toBe('always fail')
  })

  it('retry() 重置 failed 任务并立即重新执行', async () => {
    let fail = true
    const handler = vi.fn(async () => {
      if (fail) throw new Error('x')
    })
    const c = clock()
    const { store, queue } = makeQueue({ extractTags: handler }, c)
    const id = await queue.enqueue('extractTags')
    await queue.waitForIdle()
    c.advance(2_000)
    await queue.tick()
    c.advance(5_000)
    await queue.tick()
    expect((await store.get(id))?.status).toBe('failed')
    expect(handler).toHaveBeenCalledTimes(3)

    fail = false
    await queue.retry(id)
    await queue.waitForIdle()
    expect((await store.get(id))?.status).toBe('done')
    expect(handler).toHaveBeenCalledTimes(4)
  })

  it('未注册处理器的任务直接 failed，不进入退避循环', async () => {
    const { store, queue } = makeQueue({})
    const id = await queue.enqueue('extractTags')
    await queue.waitForIdle()
    const j = await store.get(id)
    expect(j?.status).toBe('failed')
    expect(j?.lastError).toMatch(/No handler registered/)
  })

  it('reportProgress 将进度合并进 payload（T4-04 断点续跑基础）', async () => {
    const { store, queue } = makeQueue({
      backfillTags: async (_job, ctx) => {
        await ctx.reportProgress({ processed: 3, total: 10 })
        await ctx.reportProgress({ processed: 4, failedIds: ['l9'] })
      },
    })
    const id = await queue.enqueue('backfillTags', { total: 10 })
    await queue.waitForIdle()
    const j = await store.get(id)
    expect(j?.status).toBe('done')
    expect(j?.payload).toMatchObject({ total: 10, processed: 4, failedIds: ['l9'] })
  })

  it('start() 恢复刷新前已到期的 retrying 任务', async () => {
    const c = clock()
    const store = new InMemoryJobStore()
    const handler = vi.fn(async () => {})
    const queue = new AsyncQueue({
      store,
      handlers: { extractTags: handler },
      now: c.now,
      pollIntervalMs: 999_999,
    })
    // 模拟上次会话留下的到期任务
    await store.put({
      id: 'old-1',
      type: 'extractTags',
      status: 'retrying',
      runAt: c.now() - 100,
      attempts: 1,
      payload: {},
      createdAt: c.now() - 10_000,
      updatedAt: c.now() - 5_000,
    })
    queue.start()
    await queue.waitForIdle()
    expect((await store.get('old-1'))?.status).toBe('done')
    queue.stop()
  })

  it('start() 把刷新前卡在 running 的任务重置为 pending 并立即重跑', async () => {
    const c = clock()
    const store = new InMemoryJobStore()
    const handler = vi.fn(async () => {})
    const queue = new AsyncQueue({
      store,
      handlers: { extractTags: handler },
      now: c.now,
      pollIntervalMs: 999_999,
    })
    await store.put({
      id: 'orphan-1',
      type: 'extractTags',
      status: 'running',
      runAt: c.now() - 999_999,
      attempts: 1,
      payload: {},
      createdAt: c.now() - 10_000,
      updatedAt: c.now() - 2_000,
    })
    queue.start()
    await queue.waitForIdle()
    const job = await store.get('orphan-1')
    expect(job?.status).toBe('done')
    expect(handler).toHaveBeenCalledOnce()
    queue.stop()
  })

  it('单并发：上一个任务未结束时新触发的 tick 不领取第二任务', async () => {
    let release: () => void = () => {}
    const blocking = new Promise<void>((r) => {
      release = r
    })
    const h1 = vi.fn(async () => {
      await blocking
    })
    const h2 = vi.fn(async () => {})
    const { store, queue } = makeQueue({ extractTags: h1, backfillTags: h2 })

    // job1 被调度并在 handler 内挂起
    const id1 = await queue.enqueue('extractTags')
    await new Promise((r) => setTimeout(r, 0))
    expect(h1).toHaveBeenCalledOnce()

    // job2 入链但不得抢先执行（此时 waitForIdle 不可能 settle，故只用宏任务观察）
    const id2 = await queue.enqueue('backfillTags')
    await new Promise((r) => setTimeout(r, 0))
    expect(h2).not.toHaveBeenCalled()
    const active = await queue.listActive()
    expect(active.find((j) => j.id === id1)?.status).toBe('running')
    expect(active.find((j) => j.id === id2)?.status).toBe('pending')

    // job1 放行后链继续，job2 自然被领取
    release()
    await queue.waitForIdle()
    expect((await store.get(id1))?.status).toBe('done')
    expect((await store.get(id2))?.status).toBe('done')
    expect(h2).toHaveBeenCalledOnce()
  })
})
