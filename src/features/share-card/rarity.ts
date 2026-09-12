/**
 * 评分 → 稀有度/角标映射（PRD §8.2 L1：1–2 星雷品 WARNING、3 COMMON、4 RARE、5 LEGENDARY）。
 * 半星取值：2.5→COMMON、4.5→RARE（4.5 属高分但不进传说档）。
 */
import type { CardData } from './types'

export type Rarity = 'warning' | 'common' | 'rare' | 'legendary'

export const RARITY_LABEL: Record<Rarity, string> = {
  warning: '⚡ 雷品 WARNING',
  common: 'COMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY 传说',
}

export function rarityOf(data: Pick<CardData, 'rating' | 'isAvoid'>): Rarity | null {
  if (data.isAvoid) return 'warning'
  const r = data.rating
  if (r === null) return null
  if (r <= 2) return 'warning'
  if (r < 4) return 'common'
  if (r < 5) return 'rare'
  return 'legendary'
}

/** 五颗星填充比例（0 / 0.5 / 1），rating null 由条件显隐整块隐藏 */
export function starFractions(rating: number): [number, number, number, number, number] {
  const f = (i: number): number => {
    const v = rating - i
    if (v >= 1) return 1
    if (v >= 0.5) return 0.5
    return 0
  }
  return [f(0), f(1), f(2), f(3), f(4)]
}

/** 导出文件名：fooddex_菜名_日期.png（PRD §8.5），剔除平台非法字符 */
export function buildCardFilename(
  dishName: string,
  ateAt: string | undefined,
  ext = 'png',
): string {
  const safeName = dishName.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'card'
  const d = ateAt ? new Date(ateAt) : new Date()
  const ymd = Number.isNaN(d.getTime())
    ? 'unknown'
    : `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `fooddex_${safeName}_${ymd}.${ext}`
}
