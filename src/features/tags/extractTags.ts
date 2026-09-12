/**
 * 单条 Log 标签提取处理器（T2-05）：打卡保存后入队 extractTags，由 AsyncQueue 异步消费。
 * 失败策略：markFailed 落库后向队列抛错 → 2/5/15s 退避重试（TDD §3.3）；
 * Log 已被删除时静默完成（不产生毒消息）。
 */
import type { AIProvider } from '@/infra/ai'
import type { JobContext, JobHandler, JobRecord } from '@/infra/queue'
import type { BackfillLogView } from '@/infra/ai/backfill'
import { flattenExtractedTags } from './backfillPort'
import { trackCapture } from '@/features/capture/analytics'

export interface ExtractTagsJobPayload {
  logId: string
}

export interface ExtractTagsDeps {
  ai: Pick<AIProvider, 'extractTags'>
  /** 单条视图（与 BackfillDataPort.listPendingLogs 同构，由组合根复用实现） */
  loadLog(logId: string): Promise<BackfillLogView | undefined>
  loadImageDataUrls(logId: string): Promise<string[]>
  markDone(logId: string, tags: ReturnType<typeof flattenExtractedTags>): Promise<void>
  markFailed(logId: string): Promise<void>
}

export function createExtractTagsHandler(deps: ExtractTagsDeps): JobHandler {
  return async (job: JobRecord, ctx: JobContext) => {
    const { logId } = (job.payload ?? {}) as ExtractTagsJobPayload
    if (!logId) return

    const view = await deps.loadLog(logId)
    if (!view) return

    try {
      const images = await deps.loadImageDataUrls(logId)
      const resp = await deps.ai.extractTags(
        {
          images,
          dishName: view.dishName,
          comment: view.comment,
          sceneHint: view.scene,
        },
        ctx.signal,
      )
      await deps.markDone(logId, flattenExtractedTags(resp.tags))
      trackCapture('tag_backfill_done', { logId })
    } catch (e) {
      if (ctx.signal.aborted) throw e
      await deps.markFailed(logId)
      throw e
    }
  }
}
