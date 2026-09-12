/**
 * 打卡运行时组合根（Agent-3 内的懒单例装配）。
 *
 * 数据层复用 @/application/data 的全局单例（与图鉴/洞察共用同一 Dexie 实例）；
 * AI 走 createAIProvider（VITE_AI_MODE=mock/bff/direct，缺省 mock）；
 * AsyncQueue 用 InMemoryJobStore（Agent-1 的 DexieJobStore 落地后替换 store 一行即可，
 * handlers 与调用点不变），注册 extractTags（T2-05）与 backfillTags（T4-04，供设置页复用）。
 */
import { createAIProvider, type AIProvider } from '@/infra/ai'
import { createBackfillTagsHandler } from '@/infra/ai/backfill'
import { AsyncQueue, InMemoryJobStore } from '@/infra/queue'
import { createBackfillDataPort } from '@/features/tags/backfillPort'
import { createExtractTagsHandler } from '@/features/tags/extractTags'
import { trackCapture } from './analytics'

export interface CaptureRuntime {
  mode: 'idb' | 'memory'
  repos: Awaited<ReturnType<typeof getDataLayer>>['repos']
  blobStore: Awaited<ReturnType<typeof getDataLayer>>['blobStore']
  ai: AIProvider
  queue: AsyncQueue
}

async function getDataLayer() {
  const { getDataLayer } = await import('@/application/data/dataLayer')
  return getDataLayer()
}

let runtimePromise: Promise<CaptureRuntime> | null = null

export function getCaptureRuntime(): Promise<CaptureRuntime> {
  if (!runtimePromise) {
    runtimePromise = bootstrap()
  }
  return runtimePromise
}

/** 仅供测试重置单例 */
export function resetCaptureRuntimeForTest(): void {
  runtimePromise = null
}

async function bootstrap(): Promise<CaptureRuntime> {
  trackCapture('capture_start')
  const layer = await getDataLayer()
  if (layer.mode === 'memory') {
    // 降级提示由 UI 呈现；此处仅埋点（persisted=false 时首页/设置页也有强提示）
    trackCapture('capture_start', { degraded: 'memory-mode' })
  }
  const ai = createAIProvider()
  const port = createBackfillDataPort(layer.repos, layer.blobStore)

  const queue = new AsyncQueue({
    store: new InMemoryJobStore(),
    handlers: {
      extractTags: createExtractTagsHandler({
        ai,
        loadLog: async (logId) => {
          const log = await layer.repos.logs.get(logId)
          if (!log) return undefined
          const dish = await layer.repos.dishes.get(log.dishId)
          return {
            logId: log.id,
            dishId: log.dishId,
            dishName: dish?.name ?? '',
            comment: log.comment || undefined,
            scene: log.scene,
          }
        },
        loadImageDataUrls: (logId) => port.loadImageDataUrls(logId),
        markDone: (logId, tags) => port.markDone(logId, tags),
        markFailed: (logId) => port.markFailed(logId),
      }),
      backfillTags: createBackfillTagsHandler({ ai, data: port }),
    },
  })
  queue.start()

  return { mode: layer.mode, repos: layer.repos, blobStore: layer.blobStore, ai, queue }
}

/** 打卡保存后入队单条标签提取（createLogWorkflow 的 enqueueTags 依赖） */
export function makeTagEnqueuer(queue: AsyncQueue): (logId: string) => Promise<string> {
  return (logId) => queue.enqueue('extractTags', { logId })
}
