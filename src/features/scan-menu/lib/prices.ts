/**
 * 一菜多价规格处理（EC-MENU-07：菜品一个实体，价格用规格数组保存）。
 * 规格归一口径与 TDD §3.4 normalizeDishName 的尾部规格正则对齐。
 */
import type { DishPrice } from '@/domain/entities'

const SPEC_ALIASES: Record<string, string> = {
  例: '例',
  例牌: '例',
  份: '例',
  位: '例',
  大: '大',
  大份: '大',
  中: '中',
  中份: '中',
  小: '小',
  小份: '小',
}

/** 规格归一：例牌→例、大份→大……未知规格原样返回 */
export function normalizeSpec(spec?: string): string | undefined {
  if (spec == null || spec === '') return undefined
  return SPEC_ALIASES[spec] ?? spec
}

/**
 * 合并 OCR 扫到的价格到菜品规格数组：
 * 同规格（归一后）覆盖旧价，其余保留；incoming 顺序优先。
 * price 为 null 的行不产生价格条目。
 */
export function mergeSpecPrices(
  existing: DishPrice[],
  incoming: Array<{ spec?: string; price: number | null }>,
): DishPrice[] {
  const result: DishPrice[] = existing.map((p) => ({ ...p }))
  for (const item of incoming) {
    if (item.price == null) continue
    const spec = normalizeSpec(item.spec)
    const hit = result.find((p) => normalizeSpec(p.spec) === spec)
    if (hit) hit.price = item.price
    else result.push({ spec, price: item.price })
  }
  return result
}
