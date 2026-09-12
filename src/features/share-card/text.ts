/**
 * 文本测量与截断（TDD §3.7：文本测量、省略号、多行截断内置；PRD §8.5 长文本规则）。
 * 纯函数：measure 由调用方注入（浏览器用 ctx.measureText，单测用固定比例假函数）。
 */
import type { TextStyle } from './types'

export type MeasureText = (text: string, style: TextStyle) => number

const ELLIPSIS = '…'

/** 单行省略：超出 maxWidth 时截断并补 …（EC-CARD-03） */
export function fitLine(
  text: string,
  style: TextStyle,
  maxWidth: number,
  measure: MeasureText,
): { text: string; truncated: boolean } {
  if (measure(text, style) <= maxWidth) return { text, truncated: false }
  let lo = 0
  let hi = text.length
  // 二分找最大可容纳字符数（保留 … 的宽度）
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(text.slice(0, mid) + ELLIPSIS, style) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return { text: text.slice(0, lo) + ELLIPSIS, truncated: true }
}

/** 多行截断：CJK 逐字贪心换行，最多 maxLines 行，末行放不下补 …（感想 ≤2 行 40 字） */
export function fitBlock(
  text: string,
  style: TextStyle,
  maxWidth: number,
  maxLines: number,
  measure: MeasureText,
): { lines: string[]; truncated: boolean } {
  const lines: string[] = []
  let rest = text
  let truncated = false
  while (rest.length > 0) {
    if (lines.length === maxLines) {
      truncated = true
      break
    }
    const isLast = lines.length === maxLines - 1
    if (measure(rest, style) <= maxWidth) {
      lines.push(rest)
      rest = ''
      break
    }
    // 找本行可容纳的字符数
    let lo = 0
    let hi = rest.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (measure(rest.slice(0, mid), style) <= maxWidth) lo = mid
      else hi = mid - 1
    }
    if (lo === 0) lo = 1 // 至少放一个字符，避免死循环
    if (isLast) {
      const fitted = fitLine(rest, style, maxWidth, measure)
      lines.push(fitted.text)
      truncated = true
      rest = ''
      break
    }
    lines.push(rest.slice(0, lo))
    rest = rest.slice(lo)
  }
  if (rest.length > 0) truncated = true
  return { lines, truncated }
}

/** 字符级字距展开宽度（Canvas 无原生 letterSpacing 时的兼容计算） */
export function widthWithSpacing(text: string, base: number, spacing: number): number {
  if (spacing === 0 || text.length === 0) return base
  return base + spacing * (text.length - 1)
}
