/**
 * AsyncQueue 类型与持久化端口（T2-05 / T4-04）。
 *
 * 所有权说明：
 * - 本文件与 AsyncQueue 属 Agent-2（src/infra/queue/）；
 * - JobStore 是端口接口：Agent-2 提供 InMemoryJobStore（dev/E2E/单测），
 *   Agent-1 后续提供 DexieJobStore（对应 TDD §4.1 的 jobs 表 'id,type,status,runAt'）；
 * - 不依赖 src/infra/db 的冻结 Repository 接口，避免循环依赖与越权改动。
 *
 * 退避策略（TDD §3.3）：2s / 5s / 15s，共 3 次；终态 failed 可手动 retry()。
 */

export type JobType = 'extractTags' | 'backfillTags'

export type JobStatus = 'pending' | 'running' | 'retrying' | 'done' | 'failed'

export interface JobRecord<P = unknown> {
  id: string
  type: JobType
  status: JobStatus
  /** 下次可执行时间（ms epoch）；retrying 态由退避调度 */
  runAt: number
  /** 已尝试次数（首次执行后记 1） */
  attempts: number
  /** 任务输入（如 { logId }）或长任务进度（backfill 的 processed/ids） */
  payload: P
  lastError?: string
  createdAt: number
  updatedAt: number
}

/** 任务持久化端口；DexieJobStore 由 Agent-1 实现 */
export interface JobStore {
  put(job: JobRecord): Promise<void>
  get(id: string): Promise<JobRecord | undefined>
  /** 取出到期任务（runAt <= now），按 runAt 升序 */
  listDue(statuses: JobStatus[], now: number): Promise<JobRecord[]>
  listByStatus(statuses: JobStatus[]): Promise<JobRecord[]>
  update(id: string, patch: Partial<JobRecord>): Promise<void>
  remove(id: string): Promise<void>
}

/** 处理器上下文：取消信号 + 进度持久化（长任务断点续跑用） */
export interface JobContext {
  signal: AbortSignal
  /** 合并写入 payload（如 { processed: 12, failedIds: [...] }），用于续跑 */
  reportProgress(patch: Record<string, unknown>): Promise<void>
}

export type JobHandler = (job: JobRecord, ctx: JobContext) => Promise<void> | void

export type JobHandlerRegistry = Partial<Record<JobType, JobHandler>>

/** 指数退避表（TDD §3.3：2 / 5 / 15s × 3） */
export const BACKOFF_MS = [2_000, 5_000, 15_000] as const

/** 最大尝试次数 = 退避档位数（首次 + 2 次重试） */
export const MAX_ATTEMPTS = BACKOFF_MS.length

/** 第 N 次失败后的退避时长（attempts 从 1 开始） */
export function backoffForAttempt(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]
}
