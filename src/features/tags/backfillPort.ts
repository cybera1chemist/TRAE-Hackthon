/**
 * BackfillDataPort 组合根实现（T2-05）：Repositories + BlobStore → Agent-2 的端口。
 * 放在 Agent-3 目录（tag 回填挂接方）而非 src/infra，避免越权；
 * markDone 合并约定：保留 source='user' 标签，AI 标签按 (dim,value) 去重后整体替换。
 */
import type { BackfillDataPort, BackfillLogView } from '@/infra/ai/backfill'
import { flattenExtractedTags } from '@/infra/ai/backfill'
import type { BlobStore, Repositories } from '@/infra/db/repositories'
import type { ID, Tag } from '@/domain/entities'
import { emitDataChanged } from '@/application/data/dataBus'

/** Blob → dataURL（图片缺失/不可读返回 null，由上层降级为无图提取） */
export function blobToDataURL(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    } catch {
      resolve(null)
    }
  })
}

/** AI 标签合并：user 保留 + 本次 AI 结果替换旧 AI（(dim,value) 去重，重跑不重复） */
export function mergeAiTags(existing: Tag[], incoming: Tag[]): Tag[] {
  const user = existing.filter((t) => t.source === 'user')
  const seen = new Set<string>()
  const ai: Tag[] = []
  for (const t of incoming) {
    const key = `${t.dim}:${t.value}`
    if (seen.has(key)) continue
    seen.add(key)
    ai.push({ ...t, source: 'ai' })
  }
  return [...user, ...ai]
}

export function createBackfillDataPort(
  repos: Repositories,
  blobStore: BlobStore,
): BackfillDataPort {
  const toView = async (logId: ID): Promise<BackfillLogView | undefined> => {
    const log = await repos.logs.get(logId)
    if (!log) return undefined
    const dish = await repos.dishes.get(log.dishId)
    return {
      logId: log.id,
      dishId: log.dishId,
      dishName: dish?.name ?? '',
      comment: log.comment || undefined,
      scene: log.scene,
    }
  }

  const listPendingIds = async (includeFailed: boolean, limit: number): Promise<ID[]> => {
    const all = await repos.logs.listAll()
    const pending = all.filter(
      (l) =>
        l.tagExtractionState === 'pending' || (includeFailed && l.tagExtractionState === 'failed'),
    )
    // listAll 倒序 → 补全按时间正序消费
    return pending
      .reverse()
      .slice(0, limit)
      .map((l) => l.id)
  }

  return {
    async listPendingLogs({ includeFailed, limit }) {
      const ids = await listPendingIds(includeFailed, limit)
      const views = await Promise.all(ids.map(toView))
      return views.filter((v): v is BackfillLogView => v !== undefined && v.dishName !== '')
    },

    async loadImageDataUrls(logId) {
      const photos = await repos.photos.listByRef('log', logId)
      const urls: string[] = []
      for (const p of photos) {
        const blob = await blobStore.get(p.blobKey)
        if (!blob) continue
        const url = await blobToDataURL(blob)
        if (url) urls.push(url)
      }
      return urls
    },

    async markDone(logId, tags) {
      const log = await repos.logs.get(logId)
      if (!log) return
      const dish = await repos.dishes.get(log.dishId)
      if (dish) {
        await repos.dishes.update(dish.id, { tags: mergeAiTags(dish.tags, tags) })
      }
      await repos.logs.update(logId, { tagExtractionState: 'done' })
      emitDataChanged('dish')
    },

    async markFailed(logId) {
      const log = await repos.logs.get(logId)
      if (!log) return
      await repos.logs.update(logId, { tagExtractionState: 'failed' })
    },

    async countRemaining(includeFailed) {
      const ids = await listPendingIds(includeFailed, Number.MAX_SAFE_INTEGER)
      return ids.length
    },
  }
}

export { flattenExtractedTags }
