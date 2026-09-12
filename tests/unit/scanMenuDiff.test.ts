import { describe, expect, it } from 'vitest'
import type { Dish } from '@/domain/entities'
import { computeMenuDiff, type DishMatcher } from '@/features/scan-menu'
import type { MenuLineDraft } from '@/features/scan-menu'

/**
 * 增量扫描 diff（T3-06 / EC-MENU-05 / TDD §3.4）。
 * matcher 为桩实现（算法归 Agent-1 T1-05），只验证 diff 编排语义。
 */

function dish(over: Partial<Dish> & { id: string; name: string }): Dish {
  return {
    restaurantId: 'r1',
    nameSource: 'ai',
    aliases: [],
    prices: [],
    status: 'unlocked',
    isAvoid: false,
    stats: { logCount: 1, avgRating: 4, latestRating: 4 },
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

/** 桩 matcher：完全相等 1.0；一方包含另一方 0.9；否则 0.1 */
const stubMatcher: DishMatcher = (lineName, d) => {
  const a = lineName.trim()
  const b = d.name.trim()
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.9
  return 0.1
}

describe('computeMenuDiff', () => {
  const existing = [
    dish({ id: 'd1', name: '水煮牛肉' }),
    dish({ id: 'd2', name: '夫妻肺片' }),
    dish({ id: 'd3', name: '酸辣汤' }),
  ]

  it('新行 → added；未出现的现存菜 → removed', () => {
    const lines = [line('水煮牛肉'), line('歌乐山辣子鸡')]
    const diff = computeMenuDiff(lines, existing, stubMatcher)
    expect(diff.added.map((l) => l.name)).toEqual(['歌乐山辣子鸡'])
    expect(diff.removed.map((d) => d.id)).toEqual(['d2', 'd3'])
    expect(diff.summary).toEqual({ added: 1, removed: 2, renamed: 0 })
  })

  it('同名但含包含关系（OCR 多识别一个字）→ renamed 候选且不算 removed', () => {
    const d1 = dish({ id: 'd1', name: '水煮牛肉' })
    const diff = computeMenuDiff([line('水煮牛肉片')], [d1], stubMatcher)
    expect(diff.removed).toHaveLength(0)
    expect(diff.renamed).toEqual([{ dish: d1, suggestedName: '水煮牛肉片', score: 0.9 }])
    expect(diff.summary).toEqual({ added: 0, removed: 0, renamed: 1 })
  })

  it('nameSource=user 的菜：仍进 renamed 候选，由 workflow 保证只提示不覆盖（EC-MENU-06）', () => {
    const userNamed = [dish({ id: 'd1', name: '水煮牛肉', nameSource: 'user' })]
    const diff = computeMenuDiff([line('水煮牛肉片')], userNamed, stubMatcher)
    expect(diff.renamed).toHaveLength(1)
    expect(diff.renamed[0].dish.nameSource).toBe('user')
  })

  it('确认页已显式关联 dishId 的行不再判 removed', () => {
    const lines = [
      line('水煮牛肉', { match: { type: 'exact', dishId: 'd1', score: 1 } }),
      line('夫妻肺片', { match: { type: 'exact', dishId: 'd2', score: 1 } }),
    ]
    const diff = computeMenuDiff(lines, existing, stubMatcher)
    expect(diff.removed.map((d) => d.id)).toEqual(['d3'])
    expect(diff.added).toHaveLength(0)
  })

  it('ignored/deleted/非菜行不计入 added（EC-MENU-04）', () => {
    const lines = [
      line('茶位费', { kind: 'fee', match: { type: 'ignored' } }),
      line('可乐', { kind: 'drink', match: { type: 'ignored' } }),
      line('不想扫进来的', { decision: 'ignored' }),
      line('已删除的', { decision: 'deleted' }),
      line('歌乐山辣子鸡'),
    ]
    const diff = computeMenuDiff(lines, existing, stubMatcher)
    expect(diff.added.map((l) => l.name)).toEqual(['歌乐山辣子鸡'])
  })

  it('阈值可调：低于阈值按 removed 处理', () => {
    const diff = computeMenuDiff([line('水煮牛肉片')], existing, stubMatcher, {
      matchThreshold: 0.95,
    })
    // 0.9 < 0.95 → 同名关联失败，d1 记 removed（严格阈值语义）
    expect(diff.removed.map((d) => d.id)).toContain('d1')
  })
})
