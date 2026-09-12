/**
 * 统计计算客户端（T4-01）：优先走 stats.worker，环境不支持（jsdom/旧浏览器）
 * 或 worker 报错时自动降级为主线程内联计算，保证大数组场景与测试环境都可用。
 * statCache（SWR：先渲染缓存、后台重算）待 Agent-1 Dexie statCache 表就绪后
 * 在本客户端外层追加，不影响 compute 调用签名。
 */
import { computeInsights } from './computeStats'
import type { StatsComputeRequest, StatsComputeResponse } from './protocol'
import type { InsightsStats, StatsSnapshot } from './types'

export interface StatsClient {
  compute(snapshot: StatsSnapshot): Promise<InsightsStats>
  dispose(): void
}

export function createStatsClient(): StatsClient {
  let worker: Worker | null = null
  let broken = false
  let seq = 0
  const pending = new Map<
    number,
    {
      resolve: (r: InsightsStats) => void
      reject: (e: Error) => void
    }
  >()

  const rejectAll = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message))
    pending.clear()
  }

  function ensureWorker(): Worker | null {
    if (broken) return null
    if (worker) return worker
    if (typeof Worker === 'undefined') {
      broken = true
      return null
    }
    try {
      const w = new Worker(new URL('../../../workers/stats.worker.ts', import.meta.url), {
        type: 'module',
      })
      w.onmessage = (event: MessageEvent<StatsComputeResponse>) => {
        const msg = event.data
        const p = pending.get(msg.requestId)
        if (!p) return
        pending.delete(msg.requestId)
        if (msg.kind === 'result') p.resolve(msg.result)
        else p.reject(new Error(msg.message))
      }
      w.onerror = (event: ErrorEvent) => {
        broken = true
        rejectAll(event.message || 'stats worker error')
      }
      worker = w
      return w
    } catch {
      broken = true
      worker = null
      return null
    }
  }

  return {
    compute(snapshot) {
      const w = ensureWorker()
      if (!w) {
        // 降级：主线程内联计算（任务分片/进度提示留待 T4-01 视图层联调时补）
        return Promise.resolve().then(() => computeInsights(snapshot))
      }
      return new Promise<InsightsStats>((resolve, reject) => {
        const requestId = ++seq
        pending.set(requestId, { resolve, reject })
        const req: StatsComputeRequest = { kind: 'compute', requestId, snapshot }
        w.postMessage(req)
      })
    },
    dispose() {
      rejectAll('stats client disposed')
      worker?.terminate()
      worker = null
      broken = true
    },
  }
}
