/**
 * 历史标签补全的数据端口适配（EC-INS-02 / T2-05 / T4-04）。
 *
 * Agent-2 的 backfill 端口明确「由组合根用 Repositories + BlobStore 实现」。
 * 本文件是中立组合代码（无业务口径），洞察页一键补全与 Agent-3 未来的
 * AsyncQueue 任务可共用同一实例。
 *
 * 标签合并约定（与 Agent-2 对齐）：保留 source='user' 标签；
 * 以 (dim,value) 去重后用本次 AI 结果替换旧 AI 标签。
 */
import type { Tag } from '@/domain/entities'
import type { DataLayer } from '@/infra/db'
import type { BackfillDataPort, BackfillLogView } from '@/infra/ai/backfill/types'

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read blob failed'))
    reader.readAsDataURL(blob)
  })
}

export function createBackfillDataPort(layer: DataLayer): BackfillDataPort {
  const { repos, blobStore } = layer

  async function pendingLogs(includeFailed: boolean): Promise<BackfillLogView[]> {
    const all = await repos.logs.listAll(1_000_000)
    const targets = all
      .filter(
        (l) =>
          l.tagExtractionState === 'pending' ||
          (includeFailed && l.tagExtractionState === 'failed'),
      )
      .sort((a, b) => a.ateAt.localeCompare(b.ateAt))
    if (targets.length === 0) return []
    const dishIds = Array.from(new Set(targets.map((l) => l.dishId)))
    const dishes = await repos.dishes.listByFilter({ ids: dishIds, limit: dishIds.length })
    const nameOf = new Map(dishes.map((d) => [d.id, d.name]))
    return targets.map((l) => ({
      logId: l.id,
      dishId: l.dishId,
      dishName: nameOf.get(l.dishId) ?? '未知菜品',
      comment: l.comment,
      scene: l.scene,
    }))
  }

  return {
    async listPendingLogs({ includeFailed, limit }) {
      const list = await pendingLogs(includeFailed)
      return list.slice(0, limit)
    },

    async countRemaining(includeFailed) {
      const list = await pendingLogs(includeFailed)
      return list.length
    },

    async loadImageDataUrls(logId) {
      const photos = await repos.photos.listByRef('log', logId)
      const urls: string[] = []
      for (const photo of photos) {
        const blob = await blobStore.get(photo.blobKey)
        if (blob) urls.push(await blobToDataUrl(blob))
      }
      return urls
    },

    async markDone(logId, aiTags: Tag[]) {
      const log = await repos.logs.get(logId)
      if (!log) return
      const dish = await repos.dishes.get(log.dishId)
      const userTags = dish ? dish.tags.filter((t) => t.source === 'user') : []
      const merged: Tag[] = []
      const seen = new Set<string>()
      for (const tag of [...userTags, ...aiTags]) {
        const key = `${tag.dim}:${tag.value}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(tag)
      }
      await repos.dishes.update(log.dishId, { tags: merged })
      await repos.logs.update(logId, { tagExtractionState: 'done' })
    },

    async markFailed(logId) {
      await repos.logs.update(logId, { tagExtractionState: 'failed' })
    },
  }
}
