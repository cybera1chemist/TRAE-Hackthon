/**
 * 店铺派生统计（PRD §7.2）—— Agent-1 T1-05
 * 由该店全部 Dish + Log 重算，与 recomputeDish 同样在写事务内同步刷新。
 */
import type { Dish, Log, RestaurantStats } from '@/domain/entities'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function aggregateRestaurantStats(dishes: Dish[], logs: Log[]): RestaurantStats {
  const rated = logs.filter((l): l is Log & { rating: number } => l.rating !== null)
  return {
    dishTotal: dishes.length,
    unlockedCount: dishes.filter((d) => d.status === 'unlocked').length,
    avoidCount: dishes.filter((d) => d.isAvoid).length,
    avgRating:
      rated.length === 0 ? null : round1(rated.reduce((s, l) => s + l.rating, 0) / rated.length),
    logCount: logs.length,
  }
}
