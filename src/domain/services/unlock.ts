/**
 * 解锁生命周期（TDD §3.3 / §6）—— Agent-1 T1-05
 *
 * 单一来源：Dish 首条 Log 提交成功 → unlocked，记录 firstLogId/unlockedAt；
 * 删光 Log → locked。派生字段只能由本模块重算，业务层不得直接写。
 */
import type { Dish, DishStatus, ID, ISODate, Log } from '@/domain/entities'

export interface UnlockState {
  status: DishStatus
  firstLogId?: ID
  unlockedAt?: ISODate
}

/** 按时间升序（ateAt，相同取 createdAt）排列的 Log 首条 */
export function earliestLog(logs: Log[]): Log | undefined {
  if (logs.length === 0) return undefined
  return [...logs].sort((a, b) => {
    const ta = a.ateAt.localeCompare(b.ateAt)
    if (ta !== 0) return ta
    return a.createdAt.localeCompare(b.createdAt)
  })[0]
}

/**
 * 从完整 Log 列表推导解锁状态。
 * @param current 重算前的 Dish（用于保留已确定的 firstLogId/unlockedAt，保证幂等）
 */
export function deriveUnlock(
  logs: Log[],
  current?: Pick<Dish, 'firstLogId' | 'unlockedAt'>,
): UnlockState {
  if (logs.length === 0) return { status: 'locked' }
  const first = earliestLog(logs)!
  return {
    status: 'unlocked',
    firstLogId: current?.firstLogId ?? first.id,
    // 解锁时刻 = 首条 Log 的创建时刻；已存在则保留（TDD §3.3）
    unlockedAt: current?.unlockedAt ?? first.createdAt,
  }
}
