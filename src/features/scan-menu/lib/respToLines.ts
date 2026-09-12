/**
 * MenuScanResp → 确认页行草稿（T3-03 数据准备）：
 * 分区展开为行、bbox 转 {x,y,w,h}、EC-MENU-04 非菜品分类、不可读区块收集。
 * 匹配字段在此先置占位（new/ignored），待 matcher 接线后由 workflow 补 matchResult。
 */
import type { MenuScanResp } from '@/infra/ai'
import { toBBox } from './bbox'
import { classifyMenuLine } from './classify'
import type { MenuLineDraft, UnreadableRegion } from '../types'

export function toLineDrafts(resp: MenuScanResp): {
  lines: MenuLineDraft[]
  unreadable: UnreadableRegion[]
} {
  const lines: MenuLineDraft[] = []
  const unreadable: UnreadableRegion[] = []

  for (const image of resp.results) {
    image.sections.forEach((section, si) => {
      section.items.forEach((item, ii) => {
        const { kind } = classifyMenuLine(item.name, section.name)
        lines.push({
          lineKey: `temp-${image.imageIndex}-${si}-${ii}`,
          section: section.name,
          rawText: item.name,
          name: item.name,
          price: item.price,
          spec: item.spec,
          confidence: item.confidence,
          bbox: toBBox(item.bbox),
          kind,
          match: { type: kind === 'dish' ? 'new' : 'ignored' },
        })
      })
    })
    for (const region of image.unreadableRegions ?? []) {
      unreadable.push({ imageIndex: image.imageIndex, bbox: toBBox(region) })
    }
  }

  return { lines, unreadable }
}
