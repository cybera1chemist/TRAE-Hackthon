/**
 * AsyncQueue（T2-05 标签异步回填 / T4-04 批量补全）。
 *
 * 行为：
 * - enqueue 立即返回（不阻塞打卡主流程，TDD §3.3），Log 先以 pending 落库；
 * - 单并发轮询到期任务；失败按 2/5/15s 退避，3 次后 failed，可手动 retry；
 * - start() 时立即扫描，页面刷新后续跑（持久化由 JobStore 保证）；
 * - 未注册处理器的任务直接 failed，避免毒消息无限重试；
 * - stop() 中止当前执行（AbortSignal）并停止轮询。
 */
import {
  backoffForAttempt,
  MAX_ATTEMPTS,
  type JobContext,
  type JobHandlerRegistry,
  type JobRecord,
  type JobStore,
  type JobType,
} from './types'

export interface AsyncQueueOptions {
  store: JobStore
  handlers: JobHandlerRegistry
  /** 轮询间隔，默认 1s */
  pollIntervalMs?: number
  /** 时钟注入（单测用假时钟） */
  now?: () => number
}

export class AsyncQueue {
  private timer: ReturnType<typeof setInterval> | null = null
  private current: { id: string; controller: AbortController } | null = null
  private readonly now: () => number
  private ticking = false
  /** 串行调度链：所有触发（enqueue/retry/轮询）都经 kick() 入队，杜绝并发跑同一任务 */
  private tickChain: Promise<void> = Promise.resolve()

  constructor(private readonly opts: AsyncQueueOptions) {
    this.now = opts.now ?? (() => Date.now())
  }

  /** 将一次 tick 排入串行链（tick 自身永不抛错） */
  private kick(): void {
    this.tickChain = this.tickChain.then(
      () => this.tick(),
      () => this.tick(),
    )
  }

  /** 等待已触发的调度全部跑完（应用初始化/测试的排空点） */
  waitForIdle(): Promise<void> {
    return this.tickChain
  }

  /** 入队；立即返回任务 ID */
  async enqueue(type: JobType, payload: unknown = {}): Promise<string> {
    const id = globalThis.crypto.randomUUID()
    const ts = this.now()
    await this.opts.store.put({
      id,
      type,
      status: 'pending',
      runAt: ts,
      attempts: 0,
      payload,
      createdAt: ts,
      updatedAt: ts,
    })
    this.kick()
    return id
  }

  getStatus(id: string): Promise<JobRecord | undefined> {
    return this.opts.store.get(id)
  }

  listActive(): Promise<JobRecord[]> {
    return this.opts.store.listByStatus(['pending', 'running', 'retrying'])
  }

  /** 手动重试 failed 任务（菜品详情/洞察页"重试 AI 提取"） */
  async retry(id: string): Promise<void> {
    await this.opts.store.update(id, {
      status: 'pending',
      runAt: this.now(),
      attempts: 0,
      lastError: undefined,
      updatedAt: this.now(),
    })
    this.kick()
  }

  /** 启动轮询；应用初始化调用一次（会立即扫描以恢复刷新前任务） */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.kick(), this.opts.pollIntervalMs ?? 1_000)
    // 先恢复崩溃时卡在 running 的任务（页面关闭/刷新中断），再跑首轮 tick
    this.tickChain = this.tickChain.then(async () => {
      const ts = this.now()
      const stale = await this.opts.store.listByStatus(['running'])
      for (const job of stale) {
        await this.opts.store.update(job.id, {
          status: 'pending',
          runAt: ts,
          updatedAt: ts,
        })
      }
      await this.tick()
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.current?.controller.abort()
    this.current = null
  }

  /** 单轮调度（公开以便测试直接驱动） */
  async tick(): Promise<void> {
    // 单并发：已有任务执行中直接跳过
    if (this.ticking || this.current) return
    const due = await this.opts.store.listDue(['pending', 'retrying'], this.now())
    if (due.length === 0) return
    const job = due[0]
    if (!job) return

    const handler = this.opts.handlers[job.type]
    if (!handler) {
      await this.opts.store.update(job.id, {
        status: 'failed',
        lastError: `No handler registered for job type: ${job.type}`,
        updatedAt: this.now(),
      })
      return
    }

    this.ticking = true
    const controller = new AbortController()
    this.current = { id: job.id, controller }
    const ctx: JobContext = {
      signal: controller.signal,
      reportProgress: async (patch) => {
        const cur = await this.opts.store.get(job.id)
        await this.opts.store.update(job.id, {
          payload: { ...((cur?.payload as Record<string, unknown>) ?? {}), ...patch },
          updatedAt: this.now(),
        })
      },
    }

    try {
      await this.opts.store.update(job.id, { status: 'running', updatedAt: this.now() })
      await handler({ ...job }, ctx)
      await this.opts.store.update(job.id, {
        status: 'done',
        attempts: job.attempts + 1,
        lastError: undefined,
        updatedAt: this.now(),
      })
    } catch (e) {
      const attempts = job.attempts + 1
      const message = (e as Error)?.message ?? String(e)
      if (attempts >= MAX_ATTEMPTS) {
        await this.opts.store.update(job.id, {
          status: 'failed',
          attempts,
          lastError: message,
          updatedAt: this.now(),
        })
      } else {
        await this.opts.store.update(job.id, {
          status: 'retrying',
          attempts,
          runAt: this.now() + backoffForAttempt(attempts),
          lastError: message,
          updatedAt: this.now(),
        })
      }
    } finally {
      this.current = null
      this.ticking = false
    }
  }
}
