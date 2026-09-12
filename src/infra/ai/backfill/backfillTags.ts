/**
 * T4-04 历史标签批量补全。
 *
 * 特性：
 * - 分页拉取 pending（可选含 failed）日志，逐条调 AI 提取标签；
 * - 断点续跑：状态置 done/failed 后即落库，中断重跑时 done 的不再返回；
 * - 单条失败不阻断整批：markFailed 后继续，最终汇总 failedIds；
 * - 进度回调：每处理一条回调一次快照，AsyncQueue 处理器写入 Job.payload；
 * - 外部 AbortSignal 中止：抛 AbortError，由队列进入退避重试（进度不丢）。
 */
import type { ID } from '@/domain/entities/common'
import type { AIProvider } from '../types'
import { flattenExtractedTags } from './flattenTags'
import type { BackfillDataPort, BackfillLogView, BackfillProgress } from './types'

export interface RunBackfillOptions {
  ai: Pick<AIProvider, 'extractTags'>
  data: BackfillDataPort
  /** 每批拉取条数，默认 20 */
  batchSize?: number
  /** 是否连历史 failed 一起重试，默认 true */
  includeFailed?: boolean
}

function aborted(): never {
  throw new DOMException('backfill aborted by caller', 'AbortError')
}

function snapshot(p: BackfillProgress): BackfillProgress {
  return { ...p, failedIds: [...p.failedIds] }
}

export async function runBackfillTags(
  opts: RunBackfillOptions,
  signal?: AbortSignal,
  onProgress?: (progress: BackfillProgress) => void | Promise<void>,
): Promise<BackfillProgress> {
  const batchSize = opts.batchSize ?? 20
  const includeFailed = opts.includeFailed ?? true

  const progress: BackfillProgress = {
    total: await opts.data.countRemaining(includeFailed),
    processed: 0,
    succeeded: 0,
    failed: 0,
    failedIds: [],
  }
  onProgress?.(snapshot(progress))

  // 本轮已处理 ID：includeFailed 时防止 failed 行被同轮重复领取造成死循环
  const seen = new Set<ID>()

  for (;;) {
    if (signal?.aborted) aborted()
    const batch = await opts.data.listPendingLogs({ includeFailed, limit: batchSize })
    const fresh = batch.filter((item: BackfillLogView) => !seen.has(item.logId))
    if (fresh.length === 0) break

    for (const item of fresh) {
      if (signal?.aborted) aborted()
      seen.add(item.logId)

      try {
        const images = await opts.data.loadImageDataUrls(item.logId)
        const resp = await opts.ai.extractTags(
          {
            images,
            dishName: item.dishName,
            comment: item.comment,
            sceneHint: item.scene,
          },
          signal,
        )
        await opts.data.markDone(item.logId, flattenExtractedTags(resp.tags))
        progress.succeeded += 1
      } catch {
        if (signal?.aborted) aborted()
        await opts.data.markFailed(item.logId)
        progress.failed += 1
        progress.failedIds.push(item.logId)
      }

      progress.processed += 1
      await onProgress?.(snapshot(progress))
    }
  }

  return snapshot(progress)
}
