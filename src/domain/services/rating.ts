/**
 * 评分聚合与 Dish 派生字段重算（TDD §4.2）—— Agent-1 T1-05
 *
 * Dish 的 status / isAvoid / stats / firstLogId / unlockedAt 均为派生字段：
 * 写路径在事务内调用 recomputeDish 同步更新；recomputeAll 可修复任何历史脏数据。
 */
import type { Dish, DishStats, Log } from '@/domain/entities'
import { deriveUnlock } from './unlock'
import { evaluateAvoid } from './avoid'

/** 评分保留 1 位小数（与 UI 半星口径一致） */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 由完整 Log 列表聚合 DishStats；无评分 → avgRating=null */
export function aggregateStats(logs: Log[]): DishStats {
  if (logs.length === 0) {
    return { logCount: 0, avgRating: null, latestRating: null }
  }
  const byTime = [...logs].sort((a, b) => {
    const t = a.ateAt.localeCompare(b.ateAt)
    return t !== 0 ? t : a.createdAt.localeCompare(b.createdAt)
  })
  const rated = logs.filter((l): l is Log & { rating: number } => l.rating !== null)
  const latest = byTime[byTime.length - 1]

  return {
    logCount: logs.length,
    avgRating:
      rated.length === 0 ? null : round1(rated.reduce((s, l) => s + l.rating, 0) / rated.length),
    latestRating: latest.rating,
    latestLogAt: latest.ateAt,
  }
}

/**
 * 一次性重算 Dish 的全部派生字段（不可变，返回新对象）。
 * isAvoid 完全由 Log 派生（evaluateAvoid）：删除踩雷 Log 即解除避雷（T1-05 验收）。
 * 无 Log 的菜可由 DishRepo.setAvoid 手动标记；一旦该菜出现 Log，以打卡事实为准重算。
 */
export function recomputeDish(dish: Dish, logs: Log[], now: string): Dish {
  const unlock = deriveUnlock(logs, dish)
  return {
    ...dish,
    status: unlock.status,
    firstLogId: unlock.firstLogId,
    unlockedAt: unlock.unlockedAt,
    isAvoid: evaluateAvoid(logs),
    stats: aggregateStats(logs),
    updatedAt: now,
  }
}
