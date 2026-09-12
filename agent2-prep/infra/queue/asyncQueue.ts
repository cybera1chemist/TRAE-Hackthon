/**
 * FoodDex · AsyncQueue 异步任务队列骨架（Agent-2 准备区草稿）
 *
 * 对应任务：T2-05（队列部分）/ T4-04 一键补全历史标签批处理
 * 对应交付：TDD §3 交付物表 "AsyncQueue | Agent-2 | Agent-3（标签回填）"
 *
 * 设计（TDD §3.3 + §4.1）：
 *   - 任务持久化到 IDB jobs 表（schema: 'id, type, status, runAt'）
 *   - 指数退避 2s / 5s / 15s × 3 次，超过终态 failed（可手动重试）
 *   - 页面刷新后续跑：启动时扫描 status=pending|retrying 的任务
 *   - 不阻塞主流程：enqueue 后立即返回，UI 通过 hook 订阅状态
 *
 * 与 Agent-1 的协作边界：
 *   - Agent-1 负责 Dexie schema（T1-01）与 jobs 表的 CRUD 实现
 *   - Agent-2 定义 JobsRepo 接口（下方），Agent-1 实现具体 SQL/Dexie 调用
 *   - 接口签名一旦冻结，Agent-1 实现需严格匹配
 */

// ─── 任务类型（与 IDB jobs 表对齐）──────────────────────────────────

export type JobType = 'extractTags' | 'backfillTags' | 'recomputeDish' | 'exportBackup'

export type JobStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed'

export interface JobRecord {
  id: string
  type: JobType
  status: JobStatus
  /** 下次执行时间（ms epoch）；retrying 态由此调度 */
  runAt: number
  /** 已重试次数；到 3 即 failed */
  attempts: number
  /** 任务输入 payload（如 { logId, dishId, images, dishName }） */
  payload: unknown
  /** 最后错误信息（failed 时填） */
  lastError?: string
  createdAt: number
  updatedAt: number
}

// ─── 仓库接口（Agent-1 实现）────────────────────────────────────────

/** Agent-2 仅依赖此接口；具体 Dexie 调用由 Agent-1 在 src/infra/db/repositories.ts 实现 */
export interface JobsRepo {
  put(job: JobRecord): Promise<void>
  get(id: string): Promise<JobRecord | undefined>
  listByStatus(statuses: JobStatus[]): Promise<JobRecord[]>
  update(id: string, patch: Partial<JobRecord>): Promise<void>
  remove(id: string): Promise<void>
}

// ─── 处理器注册 ─────────────────────────────────────────────────────

export type JobHandler = (job: JobRecord, signal: AbortSignal) => Promise<void>

export interface JobHandlerRegistry {
  extractTags: JobHandler
  backfillTags: JobHandler
  recomputeDish?: JobHandler
  exportBackup?: JobHandler
}

// ─── 退避调度（TDD §3.3：2 / 5 / 15s × 3）────────────────────────────

const BACKOFF_MS = [2_000, 5_000, 15_000]
const MAX_ATTEMPTS = BACKOFF_MS.length

const nextRunAt = (attempts: number): number => {
  const idx = Math.min(attempts, BACKOFF_MS.length - 1)
  return Date.now() + BACKOFF_MS[idx]
}

// ─── AsyncQueue 主类 ───────────────────────────────────────────────

export interface AsyncQueueOptions {
  repo: JobsRepo
  handlers: JobHandlerRegistry
  /** 轮询间隔；默认 1s */
  pollIntervalMs?: number
  /** 单并发；v1.0 简化（多并发需考虑 IDB 事务隔离） */
  concurrency?: 1
}

export class AsyncQueue {
  private timer: ReturnType<typeof setInterval> | null = null
  private currentController: AbortController | null = null

  constructor(private opts: AsyncQueueOptions) {}

  /** 入队；立即返回，不阻塞主流程 */
  async enqueue(type: JobType, payload: unknown): Promise<string> {
    const id = globalThis.crypto.randomUUID()
    const now = Date.now()
    const job: JobRecord = {
      id,
      type,
      status: 'pending',
      runAt: now,
      attempts: 0,
      payload,
      createdAt: now,
      updatedAt: now,
    }
    await this.opts.repo.put(job)
    // 立即触发一次轮询（不等下个 tick）
    void this.tick()
    return id
  }

  /** 状态查询：UI 用 useLiveQuery 订阅此返回 */
  async status(id: string): Promise<JobRecord | undefined> {
    return this.opts.repo.get(id)
  }

  /** 手动重试：将 failed 任务重置为 pending */
  async retry(id: string): Promise<void> {
    await this.opts.repo.update(id, {
      status: 'pending',
      runAt: Date.now(),
      attempts: 0,
      lastError: undefined,
      updatedAt: Date.now(),
    })
    void this.tick()
  }

  /** 启动轮询；应用初始化时调用一次 */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.opts.pollIntervalMs ?? 1_000)
    // 启动时立即扫一次，恢复刷新前未完成的任务
    void this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.currentController) {
      this.currentController.abort()
      this.currentController = null
    }
  }

  private async tick(): Promise<void> {
    if (this.currentController) return // 单并发：有任务在跑就跳过

    const due = await this.opts.repo.listByStatus(['pending', 'retrying'])
    const ready = due.filter((j) => j.runAt <= Date.now())
    if (ready.length === 0) return

    const job = ready[0] // v1.0 单并发，取最早到期的
    const controller = new AbortController()
    this.currentController = controller

    const handler = this.opts.handlers[job.type]
    if (!handler) {
      // 未注册处理器：直接标 failed，避免无限重试
      await this.opts.repo.update(job.id, {
        status: 'failed',
        lastError: `No handler for job type: ${job.type}`,
        updatedAt: Date.now(),
      })
      this.currentController = null
      return
    }

    try {
      await this.opts.repo.update(job.id, {
        status: 'running',
        updatedAt: Date.now(),
      })
      await handler(job, controller.signal)
      await this.opts.repo.update(job.id, {
        status: 'done',
        attempts: job.attempts + 1,
        updatedAt: Date.now(),
      })
    } catch (e) {
      const attempts = job.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await this.opts.repo.update(job.id, {
          status: 'failed',
          attempts,
          lastError: (e as Error)?.message ?? String(e),
          updatedAt: Date.now(),
        })
      } else {
        await this.opts.repo.update(job.id, {
          status: 'retrying',
          attempts,
          runAt: nextRunAt(attempts),
          lastError: (e as Error)?.message ?? String(e),
          updatedAt: Date.now(),
        })
      }
    } finally {
      this.currentController = null
    }
  }
}

// ─── React hook 雏形（供 Agent-3/5 调用）────────────────────────────

/**
 * 简化版 hook 草稿；正式实现放在 src/application/stores/ 或 src/infra/queue/hooks.ts
 * Agent-3 在打卡成功后调用 enqueue；UI 通过此 hook 显示"标签提取中/已完成"
 */
export function createQueueStatusSelector(queue: AsyncQueue) {
  // 真实实现用 useLiveQuery(() => repo.listByStatus(['pending','running','retrying']))
  // 这里只声明形态，不引入 React 依赖（避免 Agent-2 越界到 src/application）
  return {
    pending: () => queue,
  }
}
