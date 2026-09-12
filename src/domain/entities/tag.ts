/** 标签维度（PRD §7.4 字段约束） */
export type TagDim = 'taste' | 'cuisine' | 'ingredient' | 'cooking' | 'scene' | 'custom'

/** 标签（TDD §11 原文）；confidence 仅 ai 来源携带 */
export interface Tag {
  dim: TagDim
  value: string
  source: 'ai' | 'user'
  confidence?: number
}
