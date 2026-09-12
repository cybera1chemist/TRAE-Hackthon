import { describe, expect, it } from 'vitest'
import {
  avoidDishCount,
  cuisinePrimaryDistribution,
  dimensionDistribution,
  isWithin365,
  localDayKey,
  recentLogCount,
  streak,
  unlockedDishCount,
} from '@/domain/services/stats'
import type { Dish, Log, Tag } from '@/domain/entities'

const NOW = new Date('2024-06-01T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const dayAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString()

function logEntry(id: string, ateAt: string, dishId = 'd1'): Log {
  return {
    id,
    dishId,
    restaurantId: 'r1',
    rating: 4,
    manualAvoid: false,
    comment: '',
    price: null,
    ateAt,
    photoIds: [],
    tagExtractionState: 'done',
    createdAt: ateAt,
    updatedAt: ateAt,
  }
}

function dishEntry(id: string, tags: Tag[] = [], extra: Partial<Dish> = {}): Dish {
  return {
    id,
    restaurantId: 'r1',
    name: id,
    nameSource: 'ocr',
    aliases: [],
    prices: [],
    status: 'unlocked',
    isAvoid: false,
    tags,
    stats: { logCount: 1, avgRating: 4, latestRating: 4 },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...extra,
  }
}

describe('时间窗口与自然日', () => {
  it('localDayKey 格式', () => {
    expect(localDayKey('2024-06-01T12:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('isWithin365：近 365 天内 true，超出 false，脏日期 false', () => {
    expect(isWithin365(dayAgo(10), NOW)).toBe(true)
    expect(isWithin365(dayAgo(400), NOW)).toBe(false)
    expect(isWithin365('not-a-date', NOW)).toBe(false)
  })
})

describe('streak 连续打卡（PRD §5.4.1）', () => {
  it('无 Log → 0', () => expect(streak([], NOW)).toBe(0))
  it('今天打卡 → 1', () => expect(streak([logEntry('a', NOW.toISOString())], NOW)).toBe(1))
  it('连续 3 天', () => {
    expect(
      streak([logEntry('a', dayAgo(0)), logEntry('b', dayAgo(1)), logEntry('c', dayAgo(2))], NOW),
    ).toBe(3)
  })
  it('中间断档只计 1；同日多次只算 1 天', () => {
    expect(streak([logEntry('a', dayAgo(0)), logEntry('b', dayAgo(2))], NOW)).toBe(1)
    expect(streak([logEntry('a', dayAgo(0)), logEntry('b', dayAgo(0))], NOW)).toBe(1)
  })
  it('今天没打但昨天打了，连续不断', () => {
    expect(streak([logEntry('a', dayAgo(1)), logEntry('b', dayAgo(2))], NOW)).toBe(2)
  })
  it('昨天也没打 → 0', () => {
    expect(streak([logEntry('a', dayAgo(3))], NOW)).toBe(0)
  })
})

describe('维度占比（分母 0 → null）', () => {
  it('无数据 → null', () => {
    expect(dimensionDistribution([], [], 'taste', NOW)).toBeNull()
  })

  it('同维度内归一，ratio 和 = 1；超窗不计', () => {
    const dishes = [
      dishEntry('d1', [{ dim: 'taste', value: '麻辣', source: 'ai' }]),
      dishEntry('d2', [{ dim: 'taste', value: '甜', source: 'ai' }]),
      dishEntry('d3', [{ dim: 'taste', value: '麻辣', source: 'user' }]),
    ]
    const logs = [
      logEntry('a', dayAgo(1), 'd1'),
      logEntry('b', dayAgo(2), 'd2'),
      logEntry('c', dayAgo(400), 'd3'),
    ]
    const dist = dimensionDistribution(logs, dishes, 'taste', NOW)!
    expect(dist).not.toBeNull()
    expect(dist.find((x) => x.value === '麻辣')?.ratio).toBeCloseTo(0.5)
    expect(dist.reduce((s, x) => s + x.ratio, 0)).toBeCloseTo(1)
  })

  it('cuisine.primary 单选：每道菜只取第一个菜系标签', () => {
    const dist = cuisinePrimaryDistribution(
      [logEntry('a', dayAgo(1), 'd1')],
      [
        dishEntry('d1', [
          { dim: 'cuisine', value: '川菜', source: 'ai' },
          { dim: 'cuisine', value: '湘菜', source: 'ai' },
        ]),
      ],
      NOW,
    )!
    expect(dist.map((x) => x.value)).toEqual(['川菜'])
  })
})

describe('计数口径', () => {
  it('recentLogCount 只计近 365 天', () => {
    expect(recentLogCount([logEntry('a', dayAgo(1)), logEntry('b', dayAgo(400))], NOW)).toBe(1)
  })
  it('avoidDishCount / unlockedDishCount', () => {
    const dishes = [
      dishEntry('d1', [], { isAvoid: true }),
      dishEntry('d2', [], { status: 'locked' }),
      dishEntry('d3'),
    ]
    expect(avoidDishCount(dishes)).toBe(1)
    expect(unlockedDishCount(dishes)).toBe(2)
  })
})
