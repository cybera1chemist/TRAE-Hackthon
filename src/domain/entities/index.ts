/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 冻结契约：实体类型统一出口（TDD §11 全文 + PRD §7）。
 * 消费方：Agent-3/4/5/6 —— 只允许 import type，不在此文件内写实现逻辑。
 * ─────────────────────────────────────────────────────────────────────────────
 */
export * from './common'
export * from './tag'
export * from './dish'
export * from './log'
export * from './restaurant'
export * from './canonical'
export * from './photo'
export * from './scan'
export * from './profile'
