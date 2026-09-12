import { describe, expect, it } from 'vitest'
import { VOCAB, exportVocabForPrompt, listCanonical, normalizeTag } from '@/domain/vocab'

describe('受控词表近义归一（T1-06 验收）', () => {
  it('辣 / 很辣 / 特辣 → 麻辣', () => {
    for (const raw of ['辣', '很辣', '特辣', '超辣']) {
      const r = normalizeTag(raw, 'taste')
      expect(r.canonical).toBe('麻辣')
      expect(r.inVocab).toBe(true)
    }
  })

  it('canonical 自身命中', () => {
    const r = normalizeTag('麻辣', 'taste')
    expect(r.canonical).toBe('麻辣')
    expect(r.inVocab).toBe(true)
  })

  it('菜系/烹饪/场景同义词收敛', () => {
    expect(normalizeTag('四川菜', 'cuisine').canonical).toBe('川菜')
    expect(normalizeTag('日式', 'cuisine').canonical).toBe('日料')
    expect(normalizeTag('五花肉', 'ingredient').canonical).toBe('猪肉')
    expect(normalizeTag('宵夜', 'scene').canonical).toBe('夜宵')
  })

  it('未命中 → custom 维度，原值保留', () => {
    const r = normalizeTag('外婆的味道', 'taste')
    expect(r.dim).toBe('custom')
    expect(r.canonical).toBe('外婆的味道')
    expect(r.inVocab).toBe(false)
  })

  it('custom 维度直接透传；空串安全；大小写不敏感', () => {
    expect(normalizeTag('自定义', 'custom').dim).toBe('custom')
    expect(normalizeTag('  ', 'taste').value).toBe('')
    expect(normalizeTag('川菜', 'cuisine').canonical).toBe('川菜')
  })

  it('listCanonical / exportVocabForPrompt', () => {
    expect(listCanonical('taste')).toContain('麻辣')
    const prompt = exportVocabForPrompt()
    expect(Object.keys(prompt).sort()).toEqual([
      'cooking',
      'cuisine',
      'ingredient',
      'scene',
      'taste',
    ])
    for (const dim of Object.keys(VOCAB)) {
      expect(prompt[dim].length).toBeGreaterThan(0)
    }
  })
})
