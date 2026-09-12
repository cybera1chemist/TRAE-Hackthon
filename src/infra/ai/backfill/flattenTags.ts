/**
 * ExtractedTags（AI DTO）→ Tag[]（领域实体）展平。
 * - cuisine.primary 与 secondary 同属 cuisine 维度，按 (dim,value) 去重；
 * - 全部标 source='ai' 并保留 confidence；
 * - 用户标签不在本函数处理，由数据端口 markDone 的实现侧合并保留。
 */
import type { Tag, TagDim } from '@/domain/entities/tag'
import type { ExtractedTags, TagSuggestion } from '../types'

export function flattenExtractedTags(extracted: ExtractedTags): Tag[] {
  const out: Tag[] = []

  const pushAll = (dim: TagDim, suggestions: TagSuggestion[] | undefined): void => {
    for (const s of suggestions ?? []) {
      out.push({ dim, value: s.value, source: 'ai', confidence: s.confidence })
    }
  }

  pushAll('taste', extracted.taste)
  if (extracted.cuisine?.primary) pushAll('cuisine', [extracted.cuisine.primary])
  pushAll('cuisine', extracted.cuisine?.secondary)
  pushAll('ingredient', extracted.ingredient)
  pushAll('cooking', extracted.cooking)
  pushAll('scene', extracted.scene)
  pushAll('custom', extracted.custom)

  const seen = new Set<string>()
  return out.filter((tag) => {
    const key = `${tag.dim}:${tag.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
