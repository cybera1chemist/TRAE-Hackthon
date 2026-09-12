/**
 * 人工菜名保护（TDD §6：nameGuard）—— Agent-1 T1-05
 *
 * dish.nameSource === 'user' 时，AI/OCR 的改名建议只能进 aiSuggestedName，
 * 禁止覆盖 name/nameSource；user 通道的更新正常放行。
 * Repository 更新路径（Dexie / InMemory）必须统一经过本函数。
 */
import type { Dish } from '@/domain/entities'

export type DishPatch = Partial<Omit<Dish, 'id' | 'createdAt'>>

/**
 * 对待应用的 patch 做人工保护裁决，返回实际可落库的 patch。
 * 不修改入参。
 */
export function guardDishPatch(dish: Dish, patch: DishPatch): DishPatch {
  if (
    dish.nameSource === 'user' &&
    patch.name !== undefined &&
    patch.nameSource !== undefined &&
    patch.nameSource !== 'user'
  ) {
    // 剔除 name/nameSource，AI/OCR 建议名入建议列，保留人工值
    const { name, nameSource, ...rest } = patch
    void name
    void nameSource
    return { ...rest, aiSuggestedName: patch.name }
  }
  return patch
}
