import { describe, expect, it } from 'vitest'
import { confidenceOf, isAvoidLog, RATING_MAX, RATING_MIN, RATING_STEP } from '@/domain/entities'
import type { Dish, Log, Restaurant } from '@/domain/entities'

/** 冻结契约基线：TDD §11 confidenceOf + PRD §7.5 避雷判定 */
describe('domain/entities 冻结契约', () => {
  it('confidenceOf 三档映射（PRD §6.2）', () => {
    expect(confidenceOf(0.91)).toBe('high')
    expect(confidenceOf(0.8)).toBe('high')
    expect(confidenceOf(0.62)).toBe('medium')
    expect(confidenceOf(0.5)).toBe('medium')
    expect(confidenceOf(0.41)).toBe('low')
  })

  it('避雷判定：评分≤2 或手动标记', () => {
    expect(isAvoidLog(2, false)).toBe(true)
    expect(isAvoidLog(1.5, false)).toBe(true)
    expect(isAvoidLog(null, true)).toBe(true)
    expect(isAvoidLog(3, false)).toBe(false)
    expect(isAvoidLog(2.5, false)).toBe(false)
  })

  it('评分常量满足 0.5 步长约束', () => {
    expect(RATING_STEP).toBe(0.5)
    expect(RATING_MIN).toBeGreaterThan(0)
    expect(RATING_MAX).toBe(5)
  })

  it('实体结构冒烟：Dish/Log/Restaurant 字段可组装', () => {
    const restaurant: Restaurant = {
      id: 'rst_1',
      name: '川香小馆',
      aliases: [],
      dishIds: [],
      stats: { dishTotal: 0, unlockedCount: 0, avoidCount: 0, avgRating: null, logCount: 0 },
      createdAt: '2026-09-12T00:00:00+08:00',
      updatedAt: '2026-09-12T00:00:00+08:00',
      syncState: 'local_only',
    }
    const dish: Dish = {
      id: 'dsh_1',
      restaurantId: restaurant.id,
      name: '水煮牛肉',
      nameSource: 'user',
      aliases: [],
      prices: [{ spec: '例', price: 58 }],
      status: 'locked',
      isAvoid: false,
      stats: { logCount: 0, avgRating: null, latestRating: null },
      tags: [],
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
    }
    const log: Log = {
      id: 'log_1',
      dishId: dish.id,
      restaurantId: restaurant.id,
      rating: 4.5,
      manualAvoid: false,
      comment: '牛肉滑嫩',
      price: 58,
      ateAt: '2026-09-10T20:11:00+08:00',
      photoIds: [],
      tagExtractionState: 'pending',
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
    }
    expect(log.rating).toBe(4.5)
    expect(dish.status).toBe('locked')
  })
})
