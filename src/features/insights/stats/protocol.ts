/**
 * stats.worker 消息协议（T4-01 / TDD §3.5）。
 * worker 无状态、只负责重算；statCache 读写与 SWR 失效由主线程客户端编排
 * （statCache 表属 Agent-1 Dexie schema v1，TDD §4.1）。
 */
import type { InsightsStats, StatsSnapshot } from './types'

export type StatsComputeRequest = {
  kind: 'compute'
  requestId: number
  snapshot: StatsSnapshot
}

export type StatsComputeResponse =
  | { kind: 'result'; requestId: number; result: InsightsStats }
  | { kind: 'error'; requestId: number; message: string }
