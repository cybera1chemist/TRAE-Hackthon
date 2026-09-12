/**
 * 统计重算 worker（T4-01 / TDD §3.5：重计算放 stats.worker.ts）。
 * 输入 Log + Dish 快照，输出不可变统计结果；不触碰 DB，缓存由主线程管理。
 * Owner：Agent-5。
 * 注：不引入 webworker lib（避免与 DOM lib 全局冲突），按结构化类型收窄 self。
 */
import { computeInsights } from '@/features/insights/stats/computeStats'
import type { StatsComputeRequest, StatsComputeResponse } from '@/features/insights/stats/protocol'

interface StatsWorkerScope {
  onmessage: ((event: MessageEvent<StatsComputeRequest>) => void) | null
  postMessage(message: StatsComputeResponse): void
}

const ctx = self as unknown as StatsWorkerScope

ctx.onmessage = (event: MessageEvent<StatsComputeRequest>) => {
  const req = event.data
  if (req.kind !== 'compute') return
  try {
    const result = computeInsights(req.snapshot)
    ctx.postMessage({ kind: 'result', requestId: req.requestId, result })
  } catch (err) {
    ctx.postMessage({
      kind: 'error',
      requestId: req.requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
