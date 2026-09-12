/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 洞察统计装配层（T4-01 / PRD §5.4.1 / TDD §3.5）。
 *
 * 分层约定（与 Agent-1 对齐）：
 * - 口径原语（365 天窗口、streak、维度分布、cuisine.primary 单选、解锁/避雷计数、
 *   店铺均分）统一消费 Agent-1 冻结的领域纯服务 `@/domain/services`，禁止在此重写；
 * - 本文件只做视图模型装配：总览、云图权重/语义色、避雷库分组、worker 输出结构。
 *
 * 无副作用、不依赖 DB，可直接跑在 stats.worker 中；Agent-1 Dexie 落地前
 * 基于 Agent-0 内存假实现 + 本目录夹具即可联调。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Dish, ID, Log, TagDim } from '@/domain/entities'
import {
  aggregateRestaurantStats,
  avoidDishCount,
  cuisinePrimaryDistribution,
  dimensionDistribution,
  recentLogCount,
  streak,
  unlockedDishCount,
} from '@/domain/services'
import { tasteColor } from './semanticColors'
import { CLOUD_TOP_N, STATS_WINDOW_DAYS } from './types'
import type {
  AvoidItem,
  CloudTag,
  DistributionPoint,
  InsightsStats,
  OverviewStats,
  StatsSnapshot,
} from './types'

const DAY_MS = 86_400_000
/** 云图字号权重系数（TDD §3.5：14 + sqrt(freq) * k） */
const CLOUD_BASE_FONT = 14
const CLOUD_K = 4

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Agent-1 分布原语（分母 0 返回 null）→ 视图分布点（空数组，UI 显「—」，EC-INS-04） */
function toPoints(
  items: Array<{ value: string; count: number; ratio: number }> | null,
): DistributionPoint[] {
  return items === null ? [] : items.map((p) => ({ ...p }))
}

/** 避雷库视图模型：按店铺分组，取最近低分打卡与短评（T4-03 / PRD §5.4.1） */
function buildAvoidGroups(logs: Log[], dishes: Dish[]): Record<ID, AvoidItem[]> {
  const groups: Record<ID, AvoidItem[]> = {}
  for (const dish of dishes.filter((d) => d.isAvoid)) {
    const dishLogs = logs
      .filter((l) => l.dishId === dish.id)
      .sort((a, b) => b.ateAt.localeCompare(a.ateAt))
    const lowRated = dishLogs.filter((l) => l.rating !== null && l.rating <= 2)
    const anchor = lowRated[0]
    const latest = dishLogs[0]
    const item: AvoidItem = {
      dishId: dish.id,
      restaurantId: dish.restaurantId,
      name: dish.name,
      latestLowRating: anchor?.rating ?? null,
      latestLowAt: anchor?.ateAt ?? null,
      comment: anchor?.comment || latest?.comment || '',
      manualOnly: lowRated.length === 0,
    }
    ;(groups[dish.restaurantId] ??= []).push(item)
  }
  return groups
}

/** 全量店铺均分映射（口径复用 Agent-1 aggregateRestaurantStats；无评分 → null） */
function buildRestaurantAvg(logs: Log[]): Record<ID, number | null> {
  const logsByRestaurant = new Map<ID, Log[]>()
  for (const log of logs) {
    const list = logsByRestaurant.get(log.restaurantId) ?? []
    if (!logsByRestaurant.has(log.restaurantId)) logsByRestaurant.set(log.restaurantId, list)
    list.push(log)
  }
  const out: Record<ID, number | null> = {}
  for (const [rid, restaurantLogs] of logsByRestaurant) {
    out[rid] = aggregateRestaurantStats([], restaurantLogs).avgRating
  }
  return out
}

/**
 * 计算洞察统计（不可变、无副作用）。
 * 占比/云图：近 365 个自然日窗口（口径见 @/domain/services stats.ts）；
 * 总览类指标（累计打卡、解锁数、店铺数、连续打卡、店铺均分、避雷库）取全量。
 */
export function computeInsights(input: StatsSnapshot): InsightsStats {
  const now = input.now ?? new Date()
  const windowDays = input.windowDays ?? STATS_WINDOW_DAYS
  const { logs, dishes } = input

  const windowLogCount = recentLogCount(logs, now)
  const taste = toPoints(dimensionDistribution(logs, dishes, 'taste', now))
  const cuisineItems = cuisinePrimaryDistribution(logs, dishes, now)
  const cuisine = toPoints(cuisineItems)
  const classifiedCount = cuisine.reduce((sum, p) => sum + p.count, 0)

  // 云图 Top 20：字号权重 + 口味语义色（TDD §3.5 / PRD §5.4.1）
  const topTags: CloudTag[] = taste.slice(0, CLOUD_TOP_N).map((p) => ({
    dim: 'taste' as TagDim,
    value: p.value,
    count: p.count,
    weight: round1(CLOUD_BASE_FONT + Math.sqrt(p.count) * CLOUD_K),
    color: tasteColor(p.value),
  }))

  // ── 总览（全量口径，原语来自 Agent-1 领域服务） ──
  const unlockedDishes = dishes.filter((d) => d.status === 'unlocked')
  const weekAgoMs = now.getTime() - 7 * DAY_MS
  const overview: OverviewStats = {
    totalLogs: logs.length,
    totalDishes: dishes.length,
    unlockedDishes: unlockedDishCount(dishes),
    avoidCount: avoidDishCount(dishes),
    weekNew: unlockedDishes.filter(
      (d) => d.unlockedAt !== undefined && Date.parse(d.unlockedAt) >= weekAgoMs,
    ).length,
    restaurantCount: new Set(logs.map((l) => l.restaurantId)).size,
    streakDays: streak(logs, now),
  }

  // 近 365 个自然日窗口起点（含今天共 365 天，与 isWithin365 口径一致）
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const windowStart = new Date(startOfToday.getTime() - (windowDays - 1) * DAY_MS).toISOString()

  return {
    generatedAt: now.toISOString(),
    windowDays,
    windowStart,
    windowLogCount,
    overview,
    taste,
    cuisine,
    unclassifiedCuisineCount: windowLogCount - classifiedCount,
    topTags,
    restaurantAvg: buildRestaurantAvg(logs),
    avoidGroups: buildAvoidGroups(logs, dishes),
  }
}
