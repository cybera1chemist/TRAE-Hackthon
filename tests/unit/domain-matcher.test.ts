import { describe, expect, it } from 'vitest'
import {
  bigramJaccard,
  containmentScore,
  levenshteinDistance,
  levenshteinRatio,
  matchDish,
  similarity,
} from '@/domain/services/matcher'
import type { Dish } from '@/domain/entities'

function dish(id: string, name: string, aliases: string[] = []): Dish {
  return {
    id,
    restaurantId: 'r1',
    name,
    nameSource: 'ocr',
    aliases,
    prices: [],
    status: 'locked',
    isAvoid: false,
    tags: [],
    stats: { logCount: 0, avgRating: null, latestRating: null },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('相似度原语', () => {
  it('levenshtein', () => {
    expect(levenshteinDistance('abc', 'abd')).toBe(1)
    expect(levenshteinRatio('abcd', 'abxd')).toBeCloseTo(0.75)
    expect(levenshteinRatio('', '')).toBe(1)
  })

  it('bigramJaccard', () => {
    expect(bigramJaccard('abc', 'abc')).toBe(1)
    expect(bigramJaccard('abc', 'xyz')).toBe(0)
    expect(bigramJaccard('abc', 'abd')).toBeCloseTo(1 / 3)
  })

  it('containmentScore：连续包含且长度差 ≤2 → 0.85', () => {
    expect(containmentScore('宫保鸡丁', '宫保鸡丁饭')).toBe(0.85)
    expect(containmentScore('西红柿炒鸡蛋加葱花', '西红柿')).toBe(0)
    expect(containmentScore('宫保鸡丁', '鱼香肉丝')).toBe(0)
  })

  it('similarity 综合分', () => {
    expect(similarity('宫保鸡丁', '宫保鸡丁')).toBe(1)
    expect(similarity('宫保鸡丁', '宫保鸡丁饭')).toBeGreaterThanOrEqual(0.8)
    expect(similarity('宫保鸡丁', '鱼香肉丝')).toBeLessThan(0.5)
  })
})

describe('matchDish 阈值矩阵（0.8 / 0.95，T3-04 验收）', () => {
  it('空列表 → new', () => {
    const r = matchDish({ name: '宫保鸡丁' }, [])
    expect(r).toMatchObject({ type: 'new', userDecisionRequired: false })
  })

  it('同名 → exact 自动合并且无需确认', () => {
    const r = matchDish({ name: '宫保鸡丁' }, [dish('d1', '宫保鸡丁')])
    expect(r.type).toBe('exact')
    expect(r.dishId).toBe('d1')
    expect(r.score).toBe(1)
    expect(r.userDecisionRequired).toBe(false)
  })

  it('连续子串长度差 1 → fuzzy 必须用户确认', () => {
    const r = matchDish({ name: '宫保鸡丁饭' }, [dish('d1', '宫保鸡丁')])
    expect(r.type).toBe('fuzzy')
    expect(r.dishId).toBe('d1')
    expect(r.score).toBeGreaterThanOrEqual(0.8)
    expect(r.score).toBeLessThan(0.95)
    expect(r.userDecisionRequired).toBe(true)
  })

  it('完全不同 → new', () => {
    const r = matchDish({ name: '宫保鸡丁' }, [dish('d1', '鱼香肉丝')])
    expect(r.type).toBe('new')
    expect(r.dishId).toBeUndefined()
  })

  it('多道菜取最高分', () => {
    const r = matchDish({ name: '宫保鸡丁' }, [dish('d1', '鱼香肉丝'), dish('d2', '宫保鸡丁')])
    expect(r.dishId).toBe('d2')
  })

  it('别名命中视为同名', () => {
    const r = matchDish({ name: '辣子鸡' }, [dish('d1', '宫保鸡丁', ['辣子鸡'])])
    expect(r.type).toBe('exact')
    expect(r.dishId).toBe('d1')
  })
})
