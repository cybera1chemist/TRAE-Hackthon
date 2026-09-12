/**
 * 非菜品行识别（EC-MENU-04）：OCR 把套餐/酒水/茶位/餐具费识别为菜时，
 * 默认归入「其他」折叠区，不计入菜品解锁统计（保存时 decision='ignored'，用户可改）。
 * 关键词表为本 feature 维护，后续按 bad-case 追加（只增不改判断结构）。
 */
import type { MenuLineKind } from '../types'

/** 费用类：品名或分区命中即判 fee（茶位/餐具/纸巾/服务费等） */
const FEE_KEYWORDS = [
  '茶位',
  '餐位',
  '餐具',
  '纸巾',
  '湿巾',
  '服务费',
  '开瓶费',
  '包间费',
  '最低消费',
  '加收',
  '炭火费',
  '调料费',
] as const

/** 酒水饮料类分区名 */
const DRINK_SECTION_KEYWORDS = [
  '酒水',
  '饮品',
  '饮料',
  '酒类',
  '啤酒',
  '洋酒',
  '清酒',
  '烧酒',
] as const

/** 酒水饮料类品名关键词（保守词表：避免误伤 酒酿圆子/花雕鸡 等菜名） */
const DRINK_NAME_KEYWORDS = [
  '可乐',
  '雪碧',
  '芬达',
  '啤酒',
  '白酒',
  '红酒',
  '洋酒',
  '威士忌',
  '白兰地',
  '清酒',
  '烧酒',
  '果汁',
  '奶茶',
  '柠檬茶',
  '酸奶饮品',
  '矿泉水',
  '苏打水',
  '气泡水',
  '酸梅汤',
] as const

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

/**
 * 行分类：
 * - fee：费用类（无条件非菜）
 * - drink：分区为酒水/饮品，或品名命中饮料词表
 * - dish：其余
 */
export function classifyMenuLine(rawName: string, section?: string): { kind: MenuLineKind } {
  const name = rawName.trim()
  const sec = (section ?? '').trim()
  if (containsAny(name, FEE_KEYWORDS) || containsAny(sec, FEE_KEYWORDS)) return { kind: 'fee' }
  if (containsAny(sec, DRINK_SECTION_KEYWORDS) || containsAny(name, DRINK_NAME_KEYWORDS)) {
    return { kind: 'drink' }
  }
  return { kind: 'dish' }
}
