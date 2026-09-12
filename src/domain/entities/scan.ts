import type { ID, ISODate } from './common'
import type { DishNameSource } from './dish'

/** OCR 候选匹配类型（PRD §7.7 字段约束） */
export type OcrMatchType = 'exact' | 'fuzzy' | 'new' | 'ignored'

/** 用户对 OCR 候选的决议：无决议不允许转 Dish（PRD §7.7） */
export type OcrUserDecision = 'linked' | 'merged' | 'keptSeparate' | 'ignored' | 'deleted'

/** 菜单扫描任务状态（TDD §3.4 状态机：upload→preview→ocr→confirm→saving→done） */
export type MenuScanStatus = 'pending' | 'ocr_running' | 'ocr_done' | 'confirmed' | 'discarded'

/** 增量扫描差异摘要（PRD §7.7） */
export interface ScanDiffSummary {
  added: number
  removed: number
  renamed: number
}

/** 扫描任务（PRD §7.7） */
export interface MenuScan {
  id: ID
  restaurantId: ID
  sourceImageIds: ID[]
  status: MenuScanStatus
  isIncremental: boolean
  diffSummary?: ScanDiffSummary
  createdAt: ISODate
  confirmedAt?: ISODate
}

/** bbox 矩形（PRD §7.7 存储口径：x/y/w/h；AI 响应为 [x1,y1,x2,y2]，由 workflow 转换） */
export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface OcrMatchResult {
  type: OcrMatchType
  dishId?: ID
  score?: number
  /** fuzzy 时必须携带候选数组（PRD §7.7 字段约束） */
  candidates?: string[]
}

/** OCR 候选行（PRD §7.7）：无 userDecision 不允许转 Dish */
export interface OcrItem {
  id: ID
  scanId: ID
  sourceImageId?: ID
  section?: string
  rawText: string
  normalizedName: string
  price: number | null
  confidence: number
  bbox: BBox
  matchResult: OcrMatchResult
  userDecision?: OcrUserDecision
  createdAt: ISODate
}

/** upsertFromOcr 的输入项：用户确认后的决议（TDD §4.2） */
export interface ResolvedOcrItem {
  ocrItemId?: ID
  name: string
  nameSource: DishNameSource
  aiSuggestedName?: string
  section?: string
  price?: number | null
  matchType: OcrMatchType
  targetDishId?: ID
  userDecision: OcrUserDecision
}
