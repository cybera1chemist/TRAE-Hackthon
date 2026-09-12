import type { ID, ISODate } from './common'
import type { Tag } from './tag'

/** 菜品解锁状态：存在 ≥1 条 Log 即 unlocked（PRD §7.1） */
export type DishStatus = 'locked' | 'unlocked'

/** 菜名来源：ai 识别 / user 手填（唯一可覆盖通道）/ ocr 扫描（PRD §7.4） */
export type DishNameSource = 'ai' | 'user' | 'ocr'

export interface DishPrice {
  spec?: string
  price: number
}

/** 派生统计字段，由 Log 聚合重算（TDD §4.2 recomputeDerived） */
export interface DishStats {
  logCount: number
  avgRating: number | null
  latestRating: number | null
  latestLogAt?: ISODate
}

/** 图鉴条目 = 店铺菜品（TDD §11 / PRD §7.4） */
export interface Dish {
  id: ID
  restaurantId: ID
  name: string
  nameSource: DishNameSource
  /** AI 识别但未采纳的菜名建议（人工值不被覆盖，TDD §6） */
  aiSuggestedName?: string
  /** 跨店同名标准菜（CanonicalDish）引用 */
  canonicalDishId?: ID
  /** 菜单分区（招牌菜/凉菜…） */
  section?: string
  aliases: string[]
  prices: DishPrice[]
  status: DishStatus
  isAvoid: boolean
  unlockedAt?: ISODate
  firstLogId?: ID
  stats: DishStats
  tags: Tag[]
  createdAt: ISODate
  updatedAt: ISODate
}
