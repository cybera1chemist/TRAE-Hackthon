/**
 * 图鉴网格视图模型（T1-10，纯函数 + URL query 双向同步）。
 * 不依赖 React/DB，全部可单测；React 层只负责取数与渲染。
 */
import type { Dish, Log, Tag } from '@/domain/entities'

export type DexView = 'restaurant' | 'cuisine' | 'tag'
export type DexQuickFilter = 'all' | 'locked' | 'avoid' | 'high' | 'photo' | 'recent'
export type DexSort = 'recent' | 'unlocked' | 'rating' | 'name'

export interface DexQueryState {
  view: DexView
  filter: DexQuickFilter
  sort: DexSort
  /** 店铺/菜系视图下选中的分组 id（'' = 全部） */
  group: string
  /** 标签视图下选中的标签值（'' = 全部） */
  tag: string
  /** 全局搜索关键词（T4-06，非空时页面切到搜索结果） */
  q: string
}

export const DEFAULT_DEX_QUERY: DexQueryState = {
  view: 'restaurant',
  filter: 'all',
  sort: 'recent',
  group: '',
  tag: '',
  q: '',
}

const VIEWS: DexView[] = ['restaurant', 'cuisine', 'tag']
const FILTERS: DexQuickFilter[] = ['all', 'locked', 'avoid', 'high', 'photo', 'recent']
const SORTS: DexSort[] = ['recent', 'unlocked', 'rating', 'name']

function oneOf<T extends string>(v: string | null, allow: readonly T[], fallback: T): T {
  return v !== null && (allow as readonly string[]).includes(v) ? (v as T) : fallback
}

/** 解析 URL query（非法值回退默认，EC-DEX URL 可分享/可刷新） */
export function parseDexQuery(params: URLSearchParams): DexQueryState {
  return {
    view: oneOf(params.get('v'), VIEWS, DEFAULT_DEX_QUERY.view),
    filter: oneOf(params.get('f'), FILTERS, DEFAULT_DEX_QUERY.filter),
    sort: oneOf(params.get('s'), SORTS, DEFAULT_DEX_QUERY.sort),
    group: params.get('g') ?? '',
    tag: params.get('t') ?? '',
    q: params.get('q') ?? '',
  }
}

/** 序列化为 URL query（默认值省略，保证 URL 简洁） */
export function serializeDexQuery(state: DexQueryState): URLSearchParams {
  const p = new URLSearchParams()
  if (state.view !== DEFAULT_DEX_QUERY.view) p.set('v', state.view)
  if (state.filter !== DEFAULT_DEX_QUERY.filter) p.set('f', state.filter)
  if (state.sort !== DEFAULT_DEX_QUERY.sort) p.set('s', state.sort)
  if (state.group) p.set('g', state.group)
  if (state.tag) p.set('t', state.tag)
  if (state.q) p.set('q', state.q)
  return p
}

/** cuisine.primary 口径：dish.tags 中第一个 dim=cuisine 的标签值 */
export function primaryCuisine(dish: Dish): string | null {
  return dish.tags.find((t) => t.dim === 'cuisine')?.value ?? null
}

export interface TagCount {
  dim: Tag['dim']
  value: string
  count: number
}

/** 聚合菜品上的标签频次（标签视图云图 chips；多维度混合） */
export function collectTags(dishes: Dish[]): TagCount[] {
  const map = new Map<string, TagCount>()
  for (const d of dishes) {
    for (const t of d.tags) {
      const key = `${t.dim}:${t.value}`
      const cur = map.get(key)
      if (cur) cur.count += 1
      else map.set(key, { dim: t.dim, value: t.value, count: 1 })
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  )
}

/** 聚合主菜系分组（未分类归入 null） */
export function collectCuisines(dishes: Dish[]): Array<{ value: string; count: number }> {
  const map = new Map<string, number>()
  for (const d of dishes) {
    const c = primaryCuisine(d)
    if (!c) continue
    map.set(c, (map.get(c) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export interface DishFilterContext {
  /** dishId → 首张照片 id（photo 快捷筛选） */
  coverByDish: ReadonlyMap<string, string>
  /** 近 7 天有打卡的 dishId 集合（recent 快捷筛选） */
  recentDishIds: ReadonlySet<string>
  now?: Date
}

const DAY_MS = 86_400_000

/** 由全量 logs 构建筛选/封面上下文 */
export function buildFilterContext(logs: Log[], now: Date = new Date()): DishFilterContext {
  const coverByDish = new Map<string, string>()
  const recentDishIds = new Set<string>()
  const weekAgo = now.getTime() - 7 * DAY_MS
  for (const log of logs) {
    if (!coverByDish.has(log.dishId) && log.photoIds.length > 0) {
      coverByDish.set(log.dishId, log.photoIds[0])
    }
    if (Date.parse(log.ateAt) >= weekAgo) recentDishIds.add(log.dishId)
  }
  return { coverByDish, recentDishIds, now }
}

/** 快捷筛选（与视图分组/标签选择叠加） */
export function applyQuickFilter(
  dishes: Dish[],
  filter: DexQuickFilter,
  ctx: DishFilterContext,
): Dish[] {
  switch (filter) {
    case 'locked':
      return dishes.filter((d) => d.status === 'locked')
    case 'avoid':
      return dishes.filter((d) => d.isAvoid)
    case 'high':
      return dishes.filter((d) => (d.stats.avgRating ?? 0) >= 4)
    case 'photo':
      return dishes.filter((d) => ctx.coverByDish.has(d.id))
    case 'recent':
      return dishes.filter((d) => ctx.recentDishIds.has(d.id))
    case 'all':
    default:
      return dishes
  }
}

/** 排序（recent/name 含全部菜品；unlocked/rating 无值的沉底） */
export function sortDishes(dishes: Dish[], sort: DexSort): Dish[] {
  const arr = [...dishes]
  const dir = sort === 'name' ? 1 : -1
  arr.sort((a, b) => {
    if (sort === 'name') return dir * a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (sort === 'rating') return dir * ((a.stats.avgRating ?? -1) - (b.stats.avgRating ?? -1))
    if (sort === 'unlocked') return dir * (a.unlockedAt ?? '').localeCompare(b.unlockedAt ?? '')
    return dir * a.updatedAt.localeCompare(b.updatedAt)
  })
  return arr
}

/** 视图分组过滤（店铺/菜系选中组；标签视图标签选择） */
export function applyViewGroup(dishes: Dish[], state: DexQueryState): Dish[] {
  if (state.view === 'restaurant' && state.group) {
    return dishes.filter((d) => d.restaurantId === state.group)
  }
  if (state.view === 'cuisine' && state.group) {
    if (state.group === '__unclassified__') {
      return dishes.filter((d) => primaryCuisine(d) === null)
    }
    return dishes.filter((d) => primaryCuisine(d) === state.group)
  }
  if (state.view === 'tag' && state.tag) {
    return dishes.filter((d) => d.tags.some((t) => t.value === state.tag))
  }
  return dishes
}

/** 图鉴页顶部统计条 */
export interface DexHeaderStats {
  total: number
  unlocked: number
  avoid: number
  weekNew: number
}

export function buildDexHeaderStats(dishes: Dish[], now: Date = new Date()): DexHeaderStats {
  const weekAgo = now.getTime() - 7 * DAY_MS
  return {
    total: dishes.length,
    unlocked: dishes.filter((d) => d.status === 'unlocked').length,
    avoid: dishes.filter((d) => d.isAvoid).length,
    weekNew: dishes.filter(
      (d) => d.status === 'unlocked' && d.unlockedAt && Date.parse(d.unlockedAt) >= weekAgo,
    ).length,
  }
}

/** 搜索：店名/菜名/别名模糊（大小写不敏感），避雷结果照常返回不折叠（T4-06） */
export function searchDishes(dishes: Dish[], q: string): Dish[] {
  const k = q.trim().toLowerCase()
  if (!k) return []
  return dishes
    .filter(
      (d) => d.name.toLowerCase().includes(k) || d.aliases.some((a) => a.toLowerCase().includes(k)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** 店铺进度五档（PRD §5.3.2.4，T3-07） */
export interface ProgressTier {
  key: 'new' | 'regular' | 'foodie' | 'master' | 'complete'
  label: string
}

export function progressTier(unlocked: number, total: number): ProgressTier {
  if (total <= 0 || unlocked <= 0) return { key: 'new', label: '初来乍到' }
  const ratio = unlocked / total
  if (ratio >= 1) return { key: 'complete', label: '全图鉴制霸' }
  if (ratio >= 0.8) return { key: 'master', label: '扫地僧' }
  if (ratio >= 0.5) return { key: 'foodie', label: '老饕' }
  if (ratio >= 0.2) return { key: 'regular', label: '熟客' }
  return { key: 'new', label: '初来乍到' }
}
