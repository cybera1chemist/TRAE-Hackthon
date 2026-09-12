/**
 * 统计口径纯函数（TDD §3.5 / PRD §5.4.1）—— Agent-1 交付 Agent-5 的 stats.worker 核心
 *
 * 严格口径：
 *  - 近 365 天（ateAt ∈ [今天末 - 364天, 今天末]，含今天共 365 个自然日窗口）；
 *  - 口味/菜系占比 = 同维度内归一（各维度独立 ratio 和=1）；
 *  - cuisine.primary 单选：每道菜只取 cuisine 维度第一个标签参与菜系环形图；
 *  - 分母 0 → null（UI 显示「—」）；
 *  - streak：ateAt 转本地自然日去重，从最近一天向前数连续日（今天没打则从昨天起算）。
 */
import type { Dish, Log, TagDim } from '@/domain/entities'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 365

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** ateAt 是否落在近 365 天窗口内（含今天） */
export function isWithin365(ateAt: string, now: Date = new Date()): boolean {
  const t = new Date(ateAt).getTime()
  if (Number.isNaN(t)) return false
  const todayEnd = endOfDay(now).getTime()
  const start = todayEnd - (WINDOW_DAYS - 1) * DAY_MS
  return t >= start && t <= todayEnd
}

/** 转本地自然日 key（YYYY-MM-DD，本地时区） */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 连续打卡天数。今天未打卡时允许从昨天起算；昨天也没打 → 0。
 */
export function streak(logs: Log[], now: Date = new Date()): number {
  if (logs.length === 0) return 0
  const daySet = new Set(logs.map((l) => localDayKey(l.ateAt)))

  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!daySet.has(localDayKey(cursor.toISOString()))) {
    cursor = new Date(cursor.getTime() - DAY_MS)
    if (!daySet.has(localDayKey(cursor.toISOString()))) return 0
  }

  let count = 0
  while (daySet.has(localDayKey(cursor.toISOString()))) {
    count++
    cursor = new Date(cursor.getTime() - DAY_MS)
  }
  return count
}

export interface DistributionItem {
  value: string
  count: number
  ratio: number
}

/** 近 365 天 Log 关联 Dish 的某维度标签占比（维度内归一）；分母 0 → null */
export function dimensionDistribution(
  logs: Log[],
  dishes: Dish[],
  dim: TagDim,
  now: Date = new Date(),
): DistributionItem[] | null {
  const dishMap = new Map(dishes.map((d) => [d.id, d]))
  const counter = new Map<string, number>()

  for (const log of logs) {
    if (!isWithin365(log.ateAt, now)) continue
    const dish = dishMap.get(log.dishId)
    if (!dish) continue
    for (const tag of dish.tags) {
      if (tag.dim === dim) counter.set(tag.value, (counter.get(tag.value) ?? 0) + 1)
    }
  }

  const total = [...counter.values()].reduce((s, n) => s + n, 0)
  if (total === 0) return null
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)
}

/** 菜系单选占比：每道菜只取 cuisine 维度第一个标签；分母 0 → null */
export function cuisinePrimaryDistribution(
  logs: Log[],
  dishes: Dish[],
  now: Date = new Date(),
): DistributionItem[] | null {
  const dishMap = new Map(dishes.map((d) => [d.id, d]))
  const counter = new Map<string, number>()

  for (const log of logs) {
    if (!isWithin365(log.ateAt, now)) continue
    const dish = dishMap.get(log.dishId)
    const primary = dish?.tags.find((t) => t.dim === 'cuisine')
    if (primary) counter.set(primary.value, (counter.get(primary.value) ?? 0) + 1)
  }

  const total = [...counter.values()].reduce((s, n) => s + n, 0)
  if (total === 0) return null
  return [...counter.entries()]
    .map(([value, count]) => ({ value, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count)
}

/** 近 365 天打卡数 */
export function recentLogCount(logs: Log[], now: Date = new Date()): number {
  return logs.filter((l) => isWithin365(l.ateAt, now)).length
}

/** 避雷菜数量 */
export function avoidDishCount(dishes: Dish[]): number {
  return dishes.filter((d) => d.isAvoid).length
}

/** 已解锁菜数量 */
export function unlockedDishCount(dishes: Dish[]): number {
  return dishes.filter((d) => d.status === 'unlocked').length
}
