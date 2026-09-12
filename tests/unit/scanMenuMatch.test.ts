import { describe, expect, it } from 'vitest'
import type { Dish } from '@/domain/entities'
import { applyMatchResults, computeMenuDiff, makeDishMatcher } from '@/features/scan-menu'
import type { MenuLineDraft } from '@/features/scan-menu'

/**
 * matcher 接线（T3-04）：Agent-1 matchDish（真实算法）接入行草稿 + diff 编排。
 * 覆盖 exact 自动置位可撤销 / fuzzy 留决议阻塞保存 / new / diff 联动。
 */

function dish(over: Partial<Dish> & { id: string; name: string }): Dish {
  return {
    restaurantId: 'r1',
    nameSource: 'ai',
    aliases: [],
    prices: [],
    status: 'locked',
    isAvoid: false,
    stats: { logCount: 0, avgRating: null, latestRating: null },
    tags: [],
    createdAt: '2026-09-01T00:00:00+08:00',
    updatedAt: '2026-09-01T00:00:00+08:00',
    ...over,
  }
}

function line(name: string, over: Partial<MenuLineDraft> = {}): MenuLineDraft {
  return {
    lineKey: `temp-${name}`,
    section: '招牌菜',
    rawText: name,
    name,
    price: null,
    confidence: 0.9,
    kind: 'dish',
    match: { type: 'new' },
    ...over,
  }
}

describe('applyMatchResults（真实 matchDish）', () => {
  const existing = [dish({ id: 'd1', name: '水煮牛肉' }), dish({ id: 'd2', name: '歌乐山辣子鸡' })]

  it('exact（归一化同名）→ 自动置位 linked，可撤销语义由 UI 决定', () => {
    const [matched] = applyMatchResults([line('水煮牛肉')], existing)
    expect(matched.match).toMatchObject({ type: 'exact', dishId: 'd1', score: 1 })
    expect(matched.decision).toBe('linked')
  })

  it('OCR 多识别一个字（0.8–0.95 fuzzy）→ 留空 decision 阻塞保存，dishId 已预关联', () => {
    const [matched] = applyMatchResults([line('水煮牛肉片')], existing)
    expect(matched.match.type).toBe('fuzzy')
    expect(matched.match.dishId).toBe('d1')
    expect(matched.decision).toBeUndefined()
  })

  it('低于阈值 → new，无 dishId，等待用户决议', () => {
    const [matched] = applyMatchResults([line('麻婆豆腐')], existing)
    expect(matched.match.type).toBe('new')
    expect(matched.match.dishId).toBeUndefined()
    expect(matched.decision).toBeUndefined()
  })

  it('非菜品行（酒水/费用）不参与匹配；已有决议的行不覆盖', () => {
    const rows = [
      line('青岛啤酒', { kind: 'drink', match: { type: 'ignored' } }),
      line('餐具费', { kind: 'fee', match: { type: 'ignored' } }),
      line('手添的菜', { decision: 'keptSeparate' as const }),
    ]
    const matched = applyMatchResults(rows, existing)
    expect(matched[0].match).toEqual({ type: 'ignored' })
    expect(matched[1].match).toEqual({ type: 'ignored' })
    expect(matched[2].match).toEqual({ type: 'new' })
    expect(matched[2].decision).toBe('keptSeparate')
  })

  it('exact 自动置位后行进入 diff 的显式关联段：不算 added，同名不产 renamed', () => {
    const matched = applyMatchResults([line('水煮牛肉'), line('麻婆豆腐')], existing)
    const diff = computeMenuDiff(matched, existing, makeDishMatcher())
    expect(diff.added.map((l) => l.name)).toEqual(['麻婆豆腐'])
    expect(diff.renamed).toHaveLength(0)
    // d1 已关联，d2 未出现 → removed 候选（默认保留，仅标记）
    expect(diff.removed.map((d) => d.id)).toEqual(['d2'])
  })

  it('改名候选：OCR 行名与现存菜有差异时产出 renamed（联动 diff）', () => {
    const matched = applyMatchResults([line('歌乐山辣子鸡（微辣）')], existing)
    const diff = computeMenuDiff(matched, existing, makeDishMatcher())
    expect(diff.added).toHaveLength(0)
    expect(diff.renamed).toEqual([
      { dish: existing[1], suggestedName: '歌乐山辣子鸡（微辣）', score: expect.any(Number) },
    ])
  })
})

describe('makeDishMatcher（与 matcher 同口径）', () => {
  const matcher = makeDishMatcher()

  it('同名 1 分；包含关系 0.85（containment 口径）', () => {
    expect(matcher('水煮牛肉', dish({ id: 'd1', name: '水煮牛肉' }))).toBe(1)
    expect(matcher('水煮牛肉片', dish({ id: 'd1', name: '水煮牛肉' }))).toBe(0.85)
  })

  it('跨阈值边界：无关菜名低于 0.8', () => {
    expect(matcher('麻婆豆腐', dish({ id: 'd1', name: '歌乐山辣子鸡' }))).toBeLessThan(0.8)
  })
})
