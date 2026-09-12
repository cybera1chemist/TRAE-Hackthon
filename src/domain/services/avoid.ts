/**
 * 避雷聚合（TDD §3.3 / §6）—— Agent-1 T1-05
 *
 * 任一 Log 命中（rating≤2 或 manualAvoid）→ true；
 * 撤销避雷必须重新聚合全部 Log，不能只看最新一条。
 * 判定口径复用冻结契约 common.ts 的 isAvoidLog，保证全应用单一来源。
 */
import type { Log } from '@/domain/entities'
import { isAvoidLog } from '@/domain/entities/common'

/** 单条 Log 是否命中避雷 */
export function isLogAvoid(log: Log): boolean {
  return isAvoidLog(log.rating, log.manualAvoid)
}

/** 从全部 Log 聚合避雷状态 */
export function evaluateAvoid(logs: Log[]): boolean {
  return logs.some(isLogAvoid)
}
