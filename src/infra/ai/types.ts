/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 冻结契约（分工文档 §2.3）：AIProvider 接口与 DTO。
 * 依据：TDD §5.1 Provider 抽象 + §5.2 请求/响应契约（与 PRD §6 对齐）。
 * 自 Agent-0 交付后【只允许追加，不允许改签名】；改动须在 PR 描述 @ 受影响 Agent。
 * Owner：Agent-0 初版 → Agent-2（ai）实现 BFF/真实供应商 adapter 与 Router。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { CardTemplateId } from '@/domain/entities/profile'

// ── 超时阈值（TDD §5.1：recognize 15s / ocr 20s / tags 10s） ─────────────────

export const AI_TIMEOUT_MS = {
  recognize: 15_000,
  menuScan: 20_000,
  tags: 10_000,
  cardCopy: 10_000,
} as const

/** 允许自动重试的错误码（仅 1 次抖动退避，识别类不做多次重试） */
export const RETRIABLE_CODES: readonly AIErrorCode[] = ['NETWORK', 'TIMEOUT', 'RATE_LIMITED']

// ── 错误归一化 ───────────────────────────────────────────────────────────────

export type AIErrorCode =
  'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'AUTH' | 'BAD_OUTPUT' | 'NO_FOOD' | 'UNKNOWN'

export class AIError extends Error {
  readonly code: AIErrorCode
  readonly retriable: boolean
  readonly vendorCode?: string

  constructor(code: AIErrorCode, message?: string, vendorCode?: string) {
    super(message ?? code)
    this.name = 'AIError'
    this.code = code
    this.retriable = RETRIABLE_CODES.includes(code)
    this.vendorCode = vendorCode
  }
}

// ── 菜品识别（TDD §5.2.1） ───────────────────────────────────────────────────

/** bbox 元组口径：[x1, y1, x2, y2]（存储层转换为 {x,y,w,h}，见 PRD §7.7） */
export type BBoxTuple = [number, number, number, number]

export interface RecognizeReq {
  /** JPEG base64（或经 BFF 的 multipart 表单） */
  images: string[]
  context?: {
    restaurantId?: string
    menuHints?: string[]
  }
}

export interface RecognizedDish {
  name: string
  confidence: number
  candidates: string[]
  bbox: BBoxTuple
}

export interface RecognizeImageResult {
  imageIndex: number
  imageQuality: { blur: boolean; hasFood: boolean }
  dishes: RecognizedDish[]
}

export interface AIModelInfo {
  vendor: string
  version: string
}

export interface RecognizeResp {
  requestId: string
  results: RecognizeImageResult[]
  model: AIModelInfo
}

// ── 菜单 OCR（TDD §5.2.2） ───────────────────────────────────────────────────

export interface MenuScanReq {
  images: string[]
  restaurantId?: string
}

export interface MenuOcrLine {
  name: string
  price: number | null
  spec?: string
  confidence: number
  bbox: BBoxTuple
}

export interface MenuSection {
  name: string
  items: MenuOcrLine[]
}

export interface MenuScanImageResult {
  imageIndex: number
  sections: MenuSection[]
  /** 不可读区块（框选重扫入口） */
  unreadableRegions: BBoxTuple[]
}

export interface MenuScanResp {
  requestId: string
  results: MenuScanImageResult[]
  model: AIModelInfo
}

// ── 标签提取（TDD §5.2.3） ───────────────────────────────────────────────────

export interface TagSuggestion {
  value: string
  confidence: number
}

export interface ExtractedTags {
  taste?: TagSuggestion[]
  cuisine?: {
    primary?: TagSuggestion
    secondary?: TagSuggestion[]
  }
  ingredient?: TagSuggestion[]
  cooking?: TagSuggestion[]
  scene?: TagSuggestion[]
  /** 词表外标签必须进 custom（TDD §5.3） */
  custom?: TagSuggestion[]
}

export interface TagReq {
  images?: string[]
  dishName: string
  comment?: string
  sceneHint?: string
  vocabVersion?: string
}

export interface TagResp {
  tags: ExtractedTags
}

// ── 出片文案（card-copy.v1） ─────────────────────────────────────────────────

export interface CopyReq {
  dishName: string
  restaurantName?: string
  rating?: number | null
  tags?: string[]
  template: CardTemplateId
  /** 避雷皮肤走自嘲文案（PRD §8.4） */
  avoid?: boolean
}

export interface CopyResp {
  lines: string[]
}

// ── Provider 接口（TDD §5.1 原文） ───────────────────────────────────────────

export interface AIProvider {
  recognizeDish(req: RecognizeReq, signal?: AbortSignal): Promise<RecognizeResp>
  scanMenu(req: MenuScanReq, signal?: AbortSignal): Promise<MenuScanResp>
  extractTags(req: TagReq, signal?: AbortSignal): Promise<TagResp>
  generateCardCopy(req: CopyReq, signal?: AbortSignal): Promise<CopyResp>
}
