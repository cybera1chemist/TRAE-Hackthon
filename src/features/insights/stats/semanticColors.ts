/**
 * 口味标签语义色映射（PRD §5.4.1：辣-红、酸甜-橙、清淡-绿、奶香-米白）。
 * 云图/下钻视图统一从此取色；词表迭代时只改本表。
 * 与 Agent-1 受控词表（src/domain/vocab）对齐：近义词应先经词表归一，
 * 此处按归一后的标准口味值配色。
 */
export const TASTE_SEMANTIC_COLORS: Readonly<Record<string, string>> = {
  // 辣系 · 红
  麻辣: '#E5484D',
  香辣: '#E5484D',
  酸辣: '#E5484D',
  辣: '#E5484D',
  // 甜辣偏橙红
  甜辣: '#F76B1C',
  // 酸甜系 · 橙
  酸甜: '#F5A623',
  酸爽: '#F5A623',
  甜: '#F5A623',
  // 清淡 · 绿
  清淡: '#30A46C',
  // 咸鲜/蒜香 · 琥珀
  咸鲜: '#C9A24B',
  蒜香: '#C9A24B',
  // 奶香 · 米白
  奶香: '#E8DCC8',
  奶香味: '#E8DCC8',
}

/** 未命中语义映射的口味标签用中性灰 */
export const DEFAULT_TASTE_COLOR = '#8A8F98'

/** 按口味标签值取语义色；先精确命中，再按关键字兜底（如"微辣"归入辣红） */
export function tasteColor(value: string): string {
  const exact = TASTE_SEMANTIC_COLORS[value]
  if (exact) return exact
  if (value.includes('奶香')) return TASTE_SEMANTIC_COLORS.奶香
  if (value.includes('清淡')) return TASTE_SEMANTIC_COLORS.清淡
  if (value.includes('辣')) return TASTE_SEMANTIC_COLORS.麻辣
  if (value.includes('酸') || value.includes('甜')) return TASTE_SEMANTIC_COLORS.酸甜
  return DEFAULT_TASTE_COLOR
}
