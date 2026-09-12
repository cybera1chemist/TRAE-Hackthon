import { describe, expect, it } from 'vitest'
import { deriveUnlock, earliestLog } from '@/domain/services/unlock'
import { evaluateAvoid, isLogAvoid } from '@/domain/services/avoid'
import { aggregateStats, recomputeDish } from '@/domain/services/rating'
import { aggregateRestaurantStats } from '@/domain/services/restaurantStats'
import { guardDishPatch } from '@/domain/services/nameGuard'
import type { Dish, Log } from '@/domain/entities'

function log(partial: Partial<Log> & { id: string }): Log {
  return {
    dishId: 'd1',
    restaurantId: 'r1',
    rating: 5,
    manualAvoid: false,
    comment: '',
    price: null,
    ateAt: '2024-01-01T00:00:00Z',
    photoIds: [],
    tagExtractionState: 'done',
    createdAt: partial.ateAt ?? '2024-01-01T00:00:00Z',
    updatedAt: partial.ateAt ?? '2024-01-01T00:00:00Z',
    ...partial,
  }
}

function dish(partial: Partial<Dish> = {}): Dish {
  return {
    id: 'd1',
    restaurantId: 'r1',
    name: '测试菜',
    nameSource: 'user',
    aliases: [],
    prices: [],
    status: 'locked',
    isAvoid: false,
    tags: [],
    stats: { logCount: 0, avgRating: null, latestRating: null },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...partial,
  }
}

describe('unlock（T1-05 验收）', () => {
  it('无 Log → locked', () => {
    expect(deriveUnlock([])).toEqual({ status: 'locked' })
  })

  it('首条 Log → unlocked，firstLogId 取最早 ateAt，unlockedAt 取其 createdAt', () => {
    const logs = [
      log({ id: 'l2', ateAt: '2024-02-01T00:00:00Z', createdAt: '2024-02-01T01:00:00Z' }),
      log({ id: 'l1', ateAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T01:00:00Z' }),
    ]
    const u = deriveUnlock(logs)
    expect(u.status).toBe('unlocked')
    expect(u.firstLogId).toBe('l1')
    expect(u.unlockedAt).toBe('2024-01-01T01:00:00Z')
    expect(earliestLog(logs)?.id).toBe('l1')
  })

  it('重算幂等：已有的 firstLogId/unlockedAt 被保留', () => {
    const u = deriveUnlock([log({ id: 'l9' })], {
      firstLogId: 'l1',
      unlockedAt: '2023-12-31T00:00:00Z',
    })
    expect(u.firstLogId).toBe('l1')
    expect(u.unlockedAt).toBe('2023-12-31T00:00:00Z')
  })
})

describe('avoid（T1-05 验收）', () => {
  it('任一低分或手标命中；rating=3 不命中', () => {
    expect(evaluateAvoid([])).toBe(false)
    expect(isLogAvoid(log({ id: 'a', rating: 2 }))).toBe(true)
    expect(evaluateAvoid([log({ id: 'a', rating: 5 }), log({ id: 'b', rating: 1 })])).toBe(true)
    expect(evaluateAvoid([log({ id: 'a', rating: 3, manualAvoid: false })])).toBe(false)
    expect(evaluateAvoid([log({ id: 'a', rating: null, manualAvoid: true })])).toBe(true)
  })

  it('撤销避雷：删除命中 Log 后重算全部，恢复 false', () => {
    const all = [
      log({ id: 'a', rating: 5, ateAt: '2024-01-01T00:00:00Z' }),
      log({ id: 'b', rating: 2, ateAt: '2024-02-01T00:00:00Z' }),
    ]
    expect(evaluateAvoid(all)).toBe(true)
    expect(evaluateAvoid(all.filter((l) => l.id !== 'b'))).toBe(false)
  })
})

describe('rating 聚合', () => {
  it('空 Log → 全 null', () => {
    expect(aggregateStats([])).toEqual({
      logCount: 0,
      avgRating: null,
      latestRating: null,
    })
  })

  it('均分（忽略 null 评分，保留 1 位小数）与最近评分', () => {
    const s = aggregateStats([
      log({ id: 'a', rating: 5, ateAt: '2024-01-01T00:00:00Z' }),
      log({ id: 'b', rating: 3, ateAt: '2024-02-01T00:00:00Z' }),
      log({ id: 'c', rating: null, ateAt: '2024-03-01T00:00:00Z' }),
    ])
    expect(s.logCount).toBe(3)
    expect(s.avgRating).toBe(4)
    expect(s.latestRating).toBeNull()
    expect(s.latestLogAt).toBe('2024-03-01T00:00:00Z')
  })

  it('5 与 4 均分为 4.5', () => {
    const s = aggregateStats([
      log({ id: 'a', rating: 5, ateAt: '2024-01-01T00:00:00Z' }),
      log({ id: 'b', rating: 4, ateAt: '2024-02-01T00:00:00Z' }),
    ])
    expect(s.avgRating).toBe(4.5)
  })
})

describe('recomputeDish 综合重算（删光 Log 回 locked）', () => {
  it('有 Log：unlocked + 避雷 + stats 全部刷新', () => {
    const out = recomputeDish(
      dish(),
      [
        log({ id: 'a', rating: 1, ateAt: '2024-01-01T00:00:00Z' }),
        log({ id: 'b', rating: 5, ateAt: '2024-02-01T00:00:00Z' }),
      ],
      '2024-03-01T00:00:00Z',
    )
    expect(out.status).toBe('unlocked')
    expect(out.firstLogId).toBe('a')
    expect(out.isAvoid).toBe(true)
    expect(out.stats.logCount).toBe(2)
    expect(out.updatedAt).toBe('2024-03-01T00:00:00Z')
  })

  it('删光 Log：回 locked、清解锁字段，避雷随之解除（纯派生）', () => {
    const out = recomputeDish(
      dish({ isAvoid: true, firstLogId: 'a', unlockedAt: '2024-01-01T00:00:00Z' }),
      [],
      '2024-03-01T00:00:00Z',
    )
    expect(out.status).toBe('locked')
    expect(out.firstLogId).toBeUndefined()
    expect(out.unlockedAt).toBeUndefined()
    expect(out.isAvoid).toBe(false)
  })
})

describe('aggregateRestaurantStats', () => {
  it('店铺维度计数与均分', () => {
    const dishes = [
      dish({ id: 'd1', status: 'unlocked', isAvoid: false }),
      dish({ id: 'd2', status: 'unlocked', isAvoid: true }),
      dish({ id: 'd3', status: 'locked', isAvoid: false }),
    ]
    const logs = [
      log({ id: 'a', restaurantId: 'r1', rating: 5, ateAt: '2024-01-01T00:00:00Z' }),
      log({ id: 'b', restaurantId: 'r1', rating: 3, ateAt: '2024-02-01T00:00:00Z' }),
    ]
    expect(aggregateRestaurantStats(dishes, logs)).toEqual({
      dishTotal: 3,
      unlockedCount: 2,
      avoidCount: 1,
      avgRating: 4,
      logCount: 2,
    })
  })
})

describe('guardDishPatch 人工菜名保护（TDD §6）', () => {
  it('user 菜名被 AI/OCR 改名时，建议只入 aiSuggestedName', () => {
    const guarded = guardDishPatch(dish({ nameSource: 'user', name: '我妈做的红烧肉' }), {
      name: 'AI 建议名',
      nameSource: 'ai',
    })
    expect(guarded.name).toBeUndefined()
    expect(guarded.nameSource).toBeUndefined()
    expect(guarded.aiSuggestedName).toBe('AI 建议名')
  })

  it('user 通道改名正常放行', () => {
    const guarded = guardDishPatch(dish({ nameSource: 'user' }), {
      name: '新名字',
      nameSource: 'user',
    })
    expect(guarded.name).toBe('新名字')
  })

  it('非 user 来源的菜不受保护', () => {
    const guarded = guardDishPatch(dish({ nameSource: 'ocr' }), {
      name: '识别名',
      nameSource: 'ai',
    })
    expect(guarded.name).toBe('识别名')
  })
})
