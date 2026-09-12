import { describe, expect, it } from 'vitest'
import type { Dish, Log } from '@/domain/entities'
import {
  buildDemoDataset,
  daysAgoISO,
  makeDish,
  makeLog,
  makeTag,
} from '@/features/insights/stats/fixtures'
import { computeInsights } from '@/features/insights/stats/computeStats'
import { createStatsClient } from '@/features/insights/stats/statsClient'

const NOW = new Date('2026-09-12T12:00:00Z')
const DAY = 86_400_000
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString()

/** 组装 1 店 + N 道菜 + 打卡的最小快照 */
function snapshot(
  specs: Array<{
    dish?: Partial<Dish>
    tags?: Dish['tags']
    logs: Array<Partial<Log> & { ateAt: string; rating?: number | null }>
  }>,
) {
  const dishes: Dish[] = []
  const logs: Log[] = []
  specs.forEach((spec, i) => {
    const dish = makeDish({
      id: `dsh_t${i}`,
      restaurantId: 'rst_t',
      name: `菜${i}`,
      status: 'unlocked',
      tags: spec.tags ?? spec.dish?.tags ?? [],
      ...spec.dish,
    })
    dishes.push(dish)
    spec.logs.forEach((l, j) => {
      logs.push(
        makeLog({
          id: `log_t${i}_${j}`,
          dishId: dish.id,
          restaurantId: dish.restaurantId,
          rating: null,
          ...l,
        }),
      )
    })
  })
  return { dishes, logs }
}

describe('T4-01 洞察统计 · PRD §5.4.1 口径', () => {
  it('空数据：总览全 0、分布为空、streak 0（EC-INS-01 空态基础）', () => {
    const r = computeInsights({ logs: [], dishes: [], now: NOW })
    expect(r.overview).toMatchObject({
      totalLogs: 0,
      totalDishes: 0,
      unlockedDishes: 0,
      avoidCount: 0,
      weekNew: 0,
      restaurantCount: 0,
      streakDays: 0,
    })
    expect(r.taste).toEqual([])
    expect(r.cuisine).toEqual([])
    expect(r.unclassifiedCuisineCount).toBe(0)
    expect(r.restaurantAvg).toEqual({})
    expect(r.avoidGroups).toEqual({})
  })

  it('EC-INS-04：窗口内有打卡但全无标签 → 分布为空数组（UI 显「—」），无菜系计入未分类', () => {
    const { dishes, logs } = snapshot([{ tags: [], logs: [{ ateAt: iso(1), rating: 4 }] }])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.taste).toEqual([])
    expect(r.cuisine).toEqual([])
    expect(r.windowLogCount).toBe(1)
    expect(r.unclassifiedCuisineCount).toBe(1)
  })

  it('365 天窗口：窗口外打卡不计占比/云图，但计入累计与店铺均分', () => {
    const { dishes, logs } = snapshot([
      {
        tags: [makeTag('taste', '麻辣'), makeTag('cuisine', '川菜')],
        logs: [
          { ateAt: iso(400), rating: 5 },
          { ateAt: iso(10), rating: 3 },
        ],
      },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.windowLogCount).toBe(1)
    expect(r.overview.totalLogs).toBe(2)
    expect(r.taste).toHaveLength(1)
    expect(r.taste[0]).toMatchObject({ value: '麻辣', count: 1, ratio: 1 })
    expect(r.restaurantAvg.rst_t).toBe(4)
  })

  it('口味占比：一条多标签各计一次，同维度内归一合计 100%', () => {
    const { dishes, logs } = snapshot([
      {
        tags: [makeTag('taste', '麻辣'), makeTag('taste', '香辣')],
        logs: [
          { ateAt: iso(1), rating: 5 },
          { ateAt: iso(2), rating: 4 },
        ],
      },
      {
        tags: [makeTag('taste', '清淡')],
        logs: [{ ateAt: iso(3), rating: 4 }],
      },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    const taste = Object.fromEntries(r.taste.map((p) => [p.value, p]))
    expect(taste.麻辣.count).toBe(2)
    expect(taste.香辣.count).toBe(2)
    expect(taste.清淡.count).toBe(1)
    const sum = r.taste.reduce((s, p) => s + (p.ratio ?? 0), 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  it('维度间独立归一：无菜系打卡不稀释菜系占比，计入 unclassified', () => {
    const { dishes, logs } = snapshot([
      {
        tags: [makeTag('taste', '麻辣'), makeTag('cuisine', '川菜')],
        logs: [
          { ateAt: iso(1), rating: 5 },
          { ateAt: iso(2), rating: 4 },
        ],
      },
      {
        tags: [makeTag('taste', '清淡')],
        logs: [{ ateAt: iso(3), rating: 4 }],
      },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.cuisine).toEqual([{ value: '川菜', count: 2, ratio: 1 }])
    expect(r.unclassifiedCuisineCount).toBe(1)
  })

  it('cuisine.primary 单选：一条打卡有两个菜系标签只计主菜系一次', () => {
    const { dishes, logs } = snapshot([
      {
        tags: [makeTag('cuisine', '川菜'), makeTag('cuisine', '粤菜')],
        logs: [{ ateAt: iso(1), rating: 5 }],
      },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.cuisine).toEqual([{ value: '川菜', count: 1, ratio: 1 }])
    expect(r.unclassifiedCuisineCount).toBe(0)
  })

  it('连续打卡由 Agent-1 streak 原语驱动：近 3 天连续 → streakDays=3（装配层冒烟）', () => {
    const { dishes, logs } = snapshot([
      { logs: [{ ateAt: iso(1), rating: 5 }] },
      { dish: { id: 'dsh_s2', restaurantId: 'rst_t' }, logs: [{ ateAt: iso(2), rating: 4 }] },
      { dish: { id: 'dsh_s3', restaurantId: 'rst_t' }, logs: [{ ateAt: iso(3), rating: 4 }] },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.overview.streakDays).toBe(3)
  })

  it('店铺均分：忽略 null、保留 1 位小数；全 null → null', () => {
    const { dishes, logs } = snapshot([
      {
        logs: [
          { ateAt: iso(1), rating: 4 },
          { ateAt: iso(2), rating: 5 },
          { ateAt: iso(3), rating: null },
        ],
      },
      {
        dish: { id: 'dsh_round', restaurantId: 'rst_b' },
        logs: [
          { ateAt: iso(1), rating: 4.3 },
          { ateAt: iso(2), rating: 4.4 },
        ],
      },
      { dish: { id: 'dsh_null', restaurantId: 'rst_c' }, logs: [{ ateAt: iso(1), rating: null }] },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.restaurantAvg.rst_t).toBe(4.5)
    expect(r.restaurantAvg.rst_b).toBe(4.4)
    expect(r.restaurantAvg.rst_c).toBeNull()
  })

  it('避雷库：低分避雷与仅手动避雷分组输出（T4-03）', () => {
    const { dishes, logs } = snapshot([
      {
        dish: { id: 'dsh_a', isAvoid: true, name: '苦瓜炒蛋' },
        logs: [
          { ateAt: iso(30), rating: 1, comment: '太苦' },
          { ateAt: iso(10), rating: 3, comment: '再试一次' },
        ],
      },
      {
        dish: { id: 'dsh_b', isAvoid: true, name: '糖醋排骨' },
        logs: [{ ateAt: iso(60), rating: 4, manualAvoid: true, comment: '太甜，手动避雷' }],
      },
      {
        dish: { id: 'dsh_c', isAvoid: false, name: '普通菜' },
        logs: [{ ateAt: iso(1), rating: 1 }],
      },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.avoidGroups.rst_t).toHaveLength(2)
    const [a, b] = r.avoidGroups.rst_t
    expect(a).toMatchObject({
      dishId: 'dsh_a',
      latestLowRating: 1,
      latestLowAt: iso(30),
      comment: '太苦',
      manualOnly: false,
    })
    expect(b).toMatchObject({
      dishId: 'dsh_b',
      latestLowRating: null,
      manualOnly: true,
      comment: '太甜，手动避雷',
    })
  })

  it('云图 Top 20：截断、降序、权重 14+sqrt(freq)*4、语义色', () => {
    const specs = Array.from({ length: 21 }, (_, i) => ({
      tags: [makeTag('taste', i === 0 ? '麻辣' : `口味${i}`)],
      logs: [{ ateAt: iso(2), rating: 4 }, ...(i === 0 ? [{ ateAt: iso(1), rating: 5 }] : [])],
    }))
    const { dishes, logs } = snapshot(specs)
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.topTags).toHaveLength(20)
    expect(r.topTags[0]).toMatchObject({ value: '麻辣', count: 2, color: '#E5484D' })
    // 14 + sqrt(2) * 4 ≈ 19.7
    expect(r.topTags[0].weight).toBeCloseTo(19.7, 1)
    // count=1 的权重 = 14 + sqrt(1)*4 = 18；降序排列故榜首是 count=2
    expect(r.topTags[1].weight).toBe(18)
  })

  it('EC-DEX-03：删光打卡后快照回 locked，解锁数随之减少（由 Agent-1 重算后传入）', () => {
    const { dishes, logs } = snapshot([
      { dish: { status: 'locked' }, logs: [] },
      { dish: { status: 'unlocked' }, logs: [{ ateAt: iso(1), rating: 4 }] },
    ])
    const r = computeInsights({ logs, dishes, now: NOW })
    expect(r.overview.unlockedDishes).toBe(1)
    expect(r.overview.totalDishes).toBe(2)
  })

  it('固定故事夹具：总览/窗口/分布/均分/避雷全口径冒烟', () => {
    const ds = buildDemoDataset(NOW)
    const r = computeInsights({ logs: ds.logs, dishes: ds.dishes, now: ds.now })
    expect(r.windowLogCount).toBe(8)
    expect(r.overview).toMatchObject({
      totalLogs: 9,
      totalDishes: 9,
      unlockedDishes: 8,
      avoidCount: 2,
      weekNew: 3,
      restaurantCount: 2,
      streakDays: 3,
    })
    const cuisine = Object.fromEntries(r.cuisine.map((p) => [p.value, p]))
    expect(cuisine.川菜.count).toBe(6)
    expect(cuisine.川菜.ratio).toBeCloseTo(6 / 7, 4)
    expect(cuisine.日料.count).toBe(1)
    expect(r.unclassifiedCuisineCount).toBe(1)
    const taste = Object.fromEntries(r.taste.map((p) => [p.value, p.count]))
    expect(taste).toMatchObject({ 麻辣: 2, 香辣: 2, 清淡: 2, 甜辣: 1, 蒜香: 1, 咸鲜: 1 })
    const r1 = ds.restaurants[0].id
    const r2 = ds.restaurants[1].id
    expect(r.restaurantAvg[r1]).toBe(3.8)
    expect(r.restaurantAvg[r2]).toBe(4.3)
    expect(r.avoidGroups[r1]).toHaveLength(2)
  })

  it('statsClient：Worker 不可用时降级主线程计算，结果一致', async () => {
    const ds = buildDemoDataset(NOW)
    const client = createStatsClient()
    const r = await client.compute({ logs: ds.logs, dishes: ds.dishes, now: ds.now })
    expect(r.overview.totalLogs).toBe(9)
    expect(r.overview.streakDays).toBe(3)
    client.dispose()
  })

  it('夹具日期辅助：daysAgoISO 相对锚点偏移且保留钟点（时区安全）', () => {
    const d = new Date(daysAgoISO(NOW, 10, 19))
    expect(d.getHours()).toBe(19)
    const diffDays = (NOW.getTime() - d.getTime()) / DAY
    expect(diffDays).toBeGreaterThan(9)
    expect(diffDays).toBeLessThan(11)
  })
})
