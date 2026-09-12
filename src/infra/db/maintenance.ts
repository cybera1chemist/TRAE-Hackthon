/**
 * 数据修复：recomputeAll（T5-06 设置页"修复数据"，TDD §4.2）
 *
 * 遍历全部 Dish 用其 Log 重算派生字段，再重算各 Restaurant 统计。
 * 保证任何历史脏数据可自愈。按 Restaurant 分批事务，避免长事务。
 */
import type { FoodDexDatabase } from './database'
import { recomputeDish } from '@/domain/services/rating'
import { aggregateRestaurantStats } from '@/domain/services/restaurantStats'

const isoNow = () => new Date().toISOString()

export interface RecomputeAllResult {
  restaurants: number
  dishes: number
}

export async function recomputeAll(db: FoodDexDatabase): Promise<RecomputeAllResult> {
  const allRestaurants = await db.restaurants.toArray()
  let dishCount = 0

  for (const r of allRestaurants) {
    await db.transaction('rw', [db.dishes, db.logs, db.restaurants], async () => {
      const rDishes = await db.dishes.where('restaurantId').equals(r.id).toArray()
      for (const dish of rDishes) {
        const dishLogs = await db.logs.where('dishId').equals(dish.id).toArray()
        await db.dishes.put(recomputeDish(dish, dishLogs, isoNow()))
        dishCount++
      }
      const rLogs = await db.logs.where('restaurantId').equals(r.id).toArray()
      const refreshedDishes = await db.dishes.where('restaurantId').equals(r.id).toArray()
      await db.restaurants.put({
        ...r,
        dishIds: refreshedDishes.map((d) => d.id),
        stats: aggregateRestaurantStats(refreshedDishes, rLogs),
        updatedAt: isoNow(),
      })
    })
  }

  return { restaurants: allRestaurants.length, dishes: dishCount }
}
