/**
 * T4-04 与 AsyncQueue 的接线：backfillTags 任务处理器 + 入队快捷方式。
 *
 * 部分失败不判 job 失败（单条已落 failed 状态，failedIds 进 Job.payload 供 UI 展示）；
 * 只有整体级故障（信号中止/存储层异常）才让任务进入队列退避。
 */
import { type AsyncQueue, type JobContext, type JobRecord } from '@/infra/queue'
import { runBackfillTags, type RunBackfillOptions } from './backfillTags'
import type { BackfillProgress } from './types'

export interface BackfillJobPayload {
  batchSize?: number
  includeFailed?: boolean
  /** 进度检查点（runBackfillTags 回调写入） */
  progress?: BackfillProgress
}

export type BackfillTagsHandler = (job: JobRecord, ctx: JobContext) => Promise<void>

export function createBackfillTagsHandler(base: RunBackfillOptions): BackfillTagsHandler {
  return async (job: JobRecord, ctx: JobContext) => {
    const payload = (job.payload ?? {}) as BackfillJobPayload
    await runBackfillTags(
      {
        ...base,
        batchSize: payload.batchSize ?? base.batchSize,
        includeFailed: payload.includeFailed ?? base.includeFailed,
      },
      ctx.signal,
      (progress) => ctx.reportProgress({ progress }),
    )
  }
}

/** 入队一次历史补全（幂等由 UI 侧按 active job 判断；队列不重复去重） */
export function enqueueBackfillTags(
  queue: AsyncQueue,
  payload: Omit<BackfillJobPayload, 'progress'> = {},
): Promise<string> {
  return queue.enqueue('backfillTags', {
    batchSize: payload.batchSize ?? 20,
    includeFailed: payload.includeFailed ?? true,
  })
}
