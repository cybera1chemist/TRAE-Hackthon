import type { ID, ISODate } from './common'

/** 标签异步回填状态（TDD §3.3：pending 落库 → AsyncQueue 回填） */
export type TagExtractionState = 'pending' | 'done' | 'failed'

/** AI 识别快照，用于追溯与供应商横评（TDD §5.3） */
export interface AISnapshot {
  recognizedName: string
  confidence: number
  candidates: string[]
  modelVendor: string
  modelVersion: string
}

/** 打卡记录（TDD §11 / PRD §7.5） */
export interface Log {
  id: ID
  dishId: ID
  restaurantId: ID
  canonicalDishId?: ID
  /** null 或 0.5–5 的 0.5 步长数值 */
  rating: number | null
  manualAvoid: boolean
  comment: string
  price: number | null
  scene?: string
  ateAt: ISODate
  photoIds: ID[]
  aiSnapshot?: AISnapshot
  tagExtractionState: TagExtractionState
  createdAt: ISODate
  updatedAt: ISODate
}
