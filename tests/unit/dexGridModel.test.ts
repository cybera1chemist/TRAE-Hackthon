/**
 * T1-10 图鉴视图模型单测：URL query 双向同步、三视图分组、快捷筛选、
 * 排序、搜索（避雷不折叠）与店铺进度五档边界。
 */
import { describe, expect, it } from 'vitest'
import { makeDish, makeLog } from '@/features/insights/stats/fixtures'
import {
  applyQuickFilter,
  applyViewGroup,
  buildDexHeaderStats,
  buildFilterContext,
  collectCuisines,
  collectTags,
  parseDexQuery,
  primaryCuisine,
  progressTier,
  searchDishes,
  serializeDexQuery,
  sortDishes,
} from '@/features/dex-grid/model'
import type { Dish } from '@/domain/entities'

const NOW = new Date('2026-09-12T12:00:00+08:00')
const isoDaysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString()

function dish(partial: Partial<Dish> & Pick<Dish, 'id' | 'name' | 'restaurantId'>): Dish {
  return makeDish({
    ...partial,
    stats: partial.stats ?? { logCount: 0, avgRating: null, latestRating: null },
  })
}

describe('dex URL query', () => {
  it('非法/缺省回退默认值', () => {
    const s = parseDexQuery(new URLSearchParams('v=hack&f=nope&s=x&g=a'))
    expect(s).toEqual({
      view: 'restaurant',
      filter: 'all',
      sort: 'recent',
      group: 'a',
      tag: '',
      q: '',
    })
  })

  it('合法值解析', () => {
    const s = parseDexQuery(new URLSearchParams('v=cuisine&f=avoid&s=rating&g=川菜&t=麻辣&q=锅'))
    expect(s.view).toBe('cuisine')
    expect(s.filter).toBe('avoid')
    expect(s.sort).toBe('rating')
    expect(s.group).toBe('川菜')
    expect(s.tag).toBe('麻辣')
    expect(s.q).toBe('锅')
  })

  it('序列化省略默认值且可往返', () => {
    const params = serializeDexQuery({
      view: 'tag',
      filter: 'high',
      sort: 'name',
      group: '',
      tag: '清淡',
      q: '',
    })
    expect(params.get('v')).toBe('tag')
    expect(params.has('g')).toBe(false)
    const round = parseDexQuery(params)
    expect(round).toMatchObject({ view: 'tag', filter: 'high', sort: 'name', tag: '清淡' })
  })
})

describe('标签/菜系聚合', () => {
  const dishes = [
    dish({
      id: 'd1',
      name: '麻婆豆腐',
      restaurantId: 'r1',
      tags: [
        { dim: 'taste', value: '麻辣', source: 'ai' },
        { dim: 'cuisine', value: '川菜', source: 'ai' },
      ],
    }),
    dish({
      id: 'd2',
      name: '白切鸡',
      restaurantId: 'r1',
      tags: [
        { dim: 'taste', value: '清淡', source: 'user' },
        { dim: 'cuisine', value: '粤菜', source: 'ai' },
      ],
    }),
    dish({ id: 'd3', name: '无名菜', restaurantId: 'r2', tags: [] }),
  ]

  it('primaryCuisine 取第一个 cuisine 标签，无则 null', () => {
    expect(primaryCuisine(dishes[0])).toBe('川菜')
    expect(primaryCuisine(dishes[2])).toBeNull()
  })

  it('collectTags 按 (dim,value) 聚合计数；高频在前', () => {
    const tags = collectTags(dishes)
    expect(tags).toHaveLength(4)
    expect(tags.find((t) => t.dim === 'taste' && t.value === '麻辣')?.count).toBe(1)
    const repeated = [
      ...dishes,
      dish({
        id: 'd4',
        name: '水煮鱼',
        restaurantId: 'r2',
        tags: [{ dim: 'taste', value: '麻辣', source: 'ai' }],
      }),
    ]
    const tags2 = collectTags(repeated)
    expect(tags2[0]).toMatchObject({ dim: 'taste', value: '麻辣', count: 2 })
  })

  it('collectCuisines 不含未分类菜', () => {
    const cuisines = collectCuisines(dishes)
    expect(cuisines.map((c) => c.value)).toEqual(['川菜', '粤菜'])
  })
})

describe('筛选与排序', () => {
  const dishes: Dish[] = [
    dish({
      id: 'd1',
      name: '低分避雷菜',
      restaurantId: 'r1',
      status: 'unlocked',
      isAvoid: true,
      unlockedAt: isoDaysAgo(30),
      updatedAt: isoDaysAgo(2),
      stats: { logCount: 1, avgRating: 1.5, latestRating: 1.5 },
    }),
    dish({
      id: 'd2',
      name: '高分菜',
      restaurantId: 'r1',
      status: 'unlocked',
      unlockedAt: isoDaysAgo(10),
      updatedAt: isoDaysAgo(20),
      stats: { logCount: 2, avgRating: 4.5, latestRating: 4.5 },
    }),
    dish({
      id: 'd3',
      name: '灰菜',
      restaurantId: 'r2',
      status: 'locked',
      updatedAt: isoDaysAgo(1),
    }),
    dish({
      id: 'd4',
      name: '有图近期菜',
      restaurantId: 'r2',
      status: 'unlocked',
      unlockedAt: isoDaysAgo(2),
      updatedAt: isoDaysAgo(3),
      stats: { logCount: 1, avgRating: 3.5, latestRating: 3.5 },
    }),
  ]
  const logs = [
    makeLog({ id: 'l1', dishId: 'd1', restaurantId: 'r1', ateAt: isoDaysAgo(2), rating: 1.5 }),
    makeLog({
      id: 'l2',
      dishId: 'd4',
      restaurantId: 'r2',
      ateAt: isoDaysAgo(1),
      rating: 3.5,
      photoIds: ['pho1'],
    }),
  ]
  const ctx = buildFilterContext(logs, NOW)

  it('locked/avoid/high/photo/recent 各分支', () => {
    expect(applyQuickFilter(dishes, 'all', ctx).map((d) => d.id)).toEqual(['d1', 'd2', 'd3', 'd4'])
    expect(applyQuickFilter(dishes, 'locked', ctx).map((d) => d.id)).toEqual(['d3'])
    expect(applyQuickFilter(dishes, 'avoid', ctx).map((d) => d.id)).toEqual(['d1'])
    expect(applyQuickFilter(dishes, 'high', ctx).map((d) => d.id)).toEqual(['d2'])
    expect(applyQuickFilter(dishes, 'photo', ctx).map((d) => d.id)).toEqual(['d4'])
    expect(applyQuickFilter(dishes, 'recent', ctx).map((d) => d.id)).toEqual(['d1', 'd4'])
  })

  it('封面取该菜第一条带照片的打卡', () => {
    expect(ctx.coverByDish.get('d4')).toBe('pho1')
    expect(ctx.coverByDish.has('d1')).toBe(false)
  })

  it('rating 排序均分降序，无分沉底', () => {
    const sorted = sortDishes(dishes, 'rating').map((d) => d.id)
    expect(sorted).toEqual(['d2', 'd4', 'd1', 'd3'])
  })

  it('name 排序升序（用 ASCII 名规避 ICU 中文排序差异）', () => {
    const named = [
      dish({ id: 'n1', name: 'banana', restaurantId: 'r1' }),
      dish({ id: 'n2', name: 'apple', restaurantId: 'r1' }),
      dish({ id: 'n3', name: 'cherry', restaurantId: 'r1' }),
    ]
    expect(sortDishes(named, 'name').map((d) => d.name)).toEqual(['apple', 'banana', 'cherry'])
  })

  it('视图分组：店铺 / 菜系（含未分类） / 标签', () => {
    const byRestaurant = applyViewGroup(dishes, {
      view: 'restaurant',
      filter: 'all',
      sort: 'recent',
      group: 'r2',
      tag: '',
      q: '',
    })
    expect(byRestaurant.map((d) => d.id)).toEqual(['d3', 'd4'])

    const tagged: Dish[] = [
      dish({
        id: 't1',
        name: 'a',
        restaurantId: 'r1',
        tags: [{ dim: 'taste', value: '麻辣', source: 'ai' }],
      }),
      dish({ id: 't2', name: 'b', restaurantId: 'r1', tags: [] }),
    ]
    const byTag = applyViewGroup(tagged, {
      view: 'tag',
      filter: 'all',
      sort: 'recent',
      group: '',
      tag: '麻辣',
      q: '',
    })
    expect(byTag.map((d) => d.id)).toEqual(['t1'])

    const unclassified = applyViewGroup(tagged, {
      view: 'cuisine',
      filter: 'all',
      sort: 'recent',
      group: '__unclassified__',
      tag: '',
      q: '',
    })
    expect(unclassified.map((d) => d.id)).toEqual(['t1', 't2'])
  })
})

describe('统计条与搜索', () => {
  const dishes: Dish[] = [
    dish({
      id: 'd1',
      name: 'a',
      restaurantId: 'r1',
      status: 'unlocked',
      unlockedAt: isoDaysAgo(2),
    }),
    dish({
      id: 'd2',
      name: 'b',
      restaurantId: 'r1',
      status: 'unlocked',
      unlockedAt: isoDaysAgo(30),
    }),
    dish({
      id: 'd3',
      name: 'c',
      restaurantId: 'r1',
      status: 'unlocked',
      isAvoid: true,
      unlockedAt: isoDaysAgo(40),
    }),
    dish({ id: 'd4', name: 'd', restaurantId: 'r1', status: 'locked' }),
  ]

  it('顶部统计条口径', () => {
    const s = buildDexHeaderStats(dishes, NOW)
    expect(s).toEqual({ total: 4, unlocked: 3, avoid: 1, weekNew: 1 })
  })

  it('搜索匹配菜名/别名，避雷结果不折叠，空关键词返回空', () => {
    const withAlias = dish({
      id: 'd5',
      name: '番茄炒蛋',
      restaurantId: 'r1',
      aliases: ['西红柿炒蛋'],
      isAvoid: true,
      status: 'unlocked',
    })
    expect(searchDishes([...dishes, withAlias], '西红柿').map((d) => d.id)).toEqual(['d5'])
    expect(searchDishes([withAlias], '番').map((d) => d.id)).toEqual(['d5'])
    expect(searchDishes([withAlias], '   ')).toEqual([])
  })
})

describe('店铺进度五档（PRD §5.3.2.4）', () => {
  const cases: Array<[number, number, string]> = [
    [0, 0, '初来乍到'],
    [1, 10, '初来乍到'],
    [2, 10, '熟客'],
    [5, 10, '老饕'],
    [8, 10, '扫地僧'],
    [10, 10, '全图鉴制霸'],
  ]

  it.each(cases)('%i/%i → %s', (unlocked, total, label) => {
    expect(progressTier(unlocked, total).label).toBe(label)
  })
})

describe('T4-06 全局搜索性能（千条级本地过滤 ≤100ms）', () => {
  it('1000 道菜品的名称/别名搜索在 100ms 内完成', () => {
    const many: Dish[] = Array.from({ length: 1000 }, (_, i) =>
      dish({
        id: `p${i}`,
        name: `菜品${i}号`,
        restaurantId: `r${i % 20}`,
        aliases: [`别名${i}`],
        status: i % 3 === 0 ? 'locked' : 'unlocked',
        updatedAt: new Date(NOW.getTime() - i * 1000).toISOString(),
      }),
    )
    const start = performance.now()
    const hits = searchDishes(many, '菜品999')
    const elapsed = performance.now() - start
    expect(hits.map((d) => d.id)).toEqual(['p999'])
    expect(elapsed).toBeLessThan(100)
  })
})
