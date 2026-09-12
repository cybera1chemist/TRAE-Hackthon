/**
 * 列出全部店铺（组合层适配器）。
 *
 * 冻结的 RestaurantRepo 接口只暴露 get/search（空关键词返回空），
 * 没有 listAll。接口缺口在 Agent-1 追加方法前，这里做适配：
 *  - idb 模式：只读直查 db.restaurants（不绕过业务事务，仅读取）；
 *  - memory 模式：从全部菜品的 restaurantId 去重后逐个 get。
 * Agent-1 后续在 RestaurantRepo 追加 listAll 后，仅需替换本文件。
 */
import type { DataLayer } from '@/infra/db'
import type { Restaurant } from '@/domain/entities'

export async function listRestaurants(layer: DataLayer): Promise<Restaurant[]> {
  if (layer.db) {
    const list = await layer.db.restaurants.toArray()
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  const dishes = await layer.repos.dishes.listByFilter({})
  const ids = Array.from(new Set(dishes.map((d) => d.restaurantId)))
  const got = await Promise.all(ids.map((id) => layer.repos.restaurants.get(id)))
  return got.filter((r): r is Restaurant => r !== undefined)
}
