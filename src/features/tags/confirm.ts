/**
 * 标签确认模型（T2-06 / PRD §5.1 流程 A 标签确认步 + EC-TAG 全表）：
 * - AI 标签 confidence ≥0.6 → 直接选中区；<0.6 → 「AI 还猜了」猜测区；
 * - 用户标签（source='user'）始终在选中区且不可被 AI 覆盖；
 * - 确认 = 未勾选的猜测标签被删除，勾选的升级为已确认（confidence 提升语义）；
 * - 自定义标签词表外 → dim='custom'（TDD §5.3），source='user'。
 */
import type { Tag, TagDim } from '@/domain/entities'

export const TAG_CONFIRM_THRESHOLD = 0.6

export interface TagBands {
  /** 直接选中：user 标签 + AI ≥0.6 */
  confirmed: Array<Tag & { key: string; locked: boolean }>
  /** 猜测区：AI <0.6，默认不勾选 */
  guesses: Array<Tag & { key: string }>
}

export function tagKey(t: Pick<Tag, 'dim' | 'value'>): string {
  return `${t.dim}:${t.value}`
}

export function bandTags(tags: Tag[]): TagBands {
  const confirmed: TagBands['confirmed'] = []
  const guesses: TagBands['guesses'] = []
  for (const t of tags) {
    const key = tagKey(t)
    if (t.source === 'user') confirmed.push({ ...t, key, locked: true })
    else if ((t.confidence ?? 0) >= TAG_CONFIRM_THRESHOLD)
      confirmed.push({ ...t, key, locked: false })
    else guesses.push({ ...t, key })
  }
  return { confirmed, guesses }
}

/** 应用确认结果：AI 标签中被勾选的保留（用户可改值/维度），未勾选删除；user 标签始终保留 */
export function applyTagConfirm(
  current: Tag[],
  selectedKeys: ReadonlySet<string>,
  customAdds: Tag[] = [],
): Tag[] {
  const kept = current.filter((t) => t.source === 'user' || selectedKeys.has(tagKey(t)))
  const seen = new Set(kept.map(tagKey))
  const adds = customAdds.filter((t) => {
    const key = tagKey(t)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...kept, ...adds]
}

/** 自定义标签构造（EC-TAG-03：词表外标签 dim=custom） */
export function createCustomTag(value: string, dim: TagDim = 'custom'): Tag | null {
  const v = value.trim()
  if (!v) return null
  return { dim, value: v, source: 'user' }
}

/** 去重添加自定义标签（与现有关键字重复时忽略） */
export function addCustomTag(tags: Tag[], value: string): Tag[] {
  const tag = createCustomTag(value)
  if (!tag) return tags
  const key = tagKey(tag)
  if (tags.some((t) => tagKey(t) === key)) return tags
  return [...tags, tag]
}
