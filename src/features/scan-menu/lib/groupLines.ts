/**
 * 确认页分组（EC-MENU-04）：菜品行按分区聚簇（保持首次出现顺序），
 * 非菜品行（酒水/费用）归「其他」折叠区；空分区名的菜行归「未分区」。
 */
import type { MenuLineDraft } from '../types'

export interface LineGroup {
  key: string
  title: string
  kind: 'section' | 'other'
  lines: MenuLineDraft[]
}

const NO_SECTION = '未分区'
export const OTHER_GROUP_TITLE = '其他（酒水/茶位等）'

export function groupMenuLines(lines: MenuLineDraft[]): LineGroup[] {
  const order: string[] = []
  const bySection = new Map<string, MenuLineDraft[]>()
  const other: MenuLineDraft[] = []

  for (const line of lines) {
    if (line.kind !== 'dish') {
      other.push(line)
      continue
    }
    const title = line.section.trim() || NO_SECTION
    const bucket = bySection.get(title)
    if (bucket) {
      bucket.push(line)
    } else {
      bySection.set(title, [line])
      order.push(title)
    }
  }

  const groups: LineGroup[] = order.map((title) => ({
    key: `sec:${title}`,
    title,
    kind: 'section',
    lines: bySection.get(title) ?? [],
  }))
  if (other.length > 0) {
    groups.push({ key: 'other', title: OTHER_GROUP_TITLE, kind: 'other', lines: other })
  }
  return groups
}
