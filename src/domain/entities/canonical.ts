import type { ID } from './common'
import type { TagDim } from './tag'

/**
 * 标准菜品抽象：跨店同名菜的统计聚合锚点（PRD §7.3）。
 * 不参与图鉴三态展示，仅用于菜系/口味维度统计。
 */
export interface CanonicalDish {
  id: ID
  name: string
  cuisinePrimary?: string
  /** 维度 → 受控词表值（用于统计兜底） */
  defaultTags?: Partial<Record<TagDim, string[]>>
  aliases: string[]
}
