/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 冻结契约（分工文档 §2.3）：本目录类型自 Agent-0 交付后【只允许追加，不允许改签名】。
 * 依据：TDD §11 全文 + PRD §7 数据结构。改动须在 PR 描述 @ 所有受影响 Agent。
 * Owner：Agent-1（data）负责后续实现与扩展。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 全局唯一 ID（字符串，前缀约定：rst_/dsh_/log_/pho_/scan_/ocr_/can_/job_） */
export type ID = string

/** ISO 8601 日期时间字符串（如 2026-09-12T19:30:00+08:00） */
export type ISODate = string

/** v1.0 数据仅存本地（PRD §7.2 syncState） */
export type SyncState = 'local_only'

/** 置信度三档（PRD §6.2：≥0.8 高 / 0.5–0.8 中 / <0.5 低） */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/** 置信度 → 三档映射，供 UI 徽标使用（TDD §11 原文） */
export const confidenceOf = (c: number): ConfidenceLevel =>
  c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low'

/** 评分约束：0.5 步长，范围 0.5–5（PRD §7.5） */
export const RATING_MIN = 0.5
export const RATING_MAX = 5
export const RATING_STEP = 0.5

/** 避雷判定单一来源：任一 Log 评分 ≤2 或手动标记（PRD §7.5） */
export const isAvoidLog = (rating: number | null, manualAvoid: boolean): boolean =>
  manualAvoid || (rating !== null && rating <= 2)
