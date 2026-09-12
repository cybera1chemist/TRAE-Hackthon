/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 洞察统计类型（T4-01 / PRD §5.4.1 / TDD §3.5）。
 * 统计重算为纯函数：输入 Log + Dish 快照，输出不可变结果；不依赖 DB/AI，
 * 因此可在 Agent-1 Dexie 落地前基于 Agent-0 内存假实现并行开发。
 * Owner：Agent-5（dex/insights）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Dish, ID, Log, TagDim } from '@/domain/entities'

/** 近 365 天窗口（PRD §5.4.1 口径表） */
export const STATS_WINDOW_DAYS = 365

/** 云图默认展示 Top N（PRD §5.4.1） */
export const CLOUD_TOP_N = 20

/** 统计输入快照（由调用方经 Repository 拉全量后传入 worker） */
export interface StatsSnapshot {
  logs: Log[]
  dishes: Dish[]
  /** 注入当前时间，便于单测与历史回放；默认 new Date() */
  now?: Date
  /** 窗口天数，默认 365 */
  windowDays?: number
}

/** 维度内占比分布点；同维度合计 100% */
export interface DistributionPoint {
  value: string
  count: number
  /** 维度内归一占比 [0,1]；分母为 0 时为 null（EC-INS-04：UI 显「—」而非 0%） */
  ratio: number | null
}

/** 云图标签（字号权重 14 + sqrt(freq) * k，TDD §3.5） */
export interface CloudTag {
  dim: TagDim
  value: string
  count: number
  weight: number
  /** 口味语义色（PRD §5.4.1：辣-红、酸甜-橙、清淡-绿、奶香-米白） */
  color?: string
}

/** 避雷库条目（T4-03：店铺分组、低分与短评、撤销入口） */
export interface AvoidItem {
  dishId: ID
  restaurantId: ID
  name: string
  /** 最近一次 ≤2 分评分；仅手动标记、从无低分时为 null */
  latestLowRating: number | null
  latestLowAt: string | null
  /** 低分打卡短评；无低分记录时回退最近一条打卡评论 */
  comment: string
  /** true = 仅手动标记避雷、从无评分（PRD §5.4.1 触发规则第 4 条同等参与提醒） */
  manualOnly: boolean
}

/** 总览卡片（PRD §5.4.1 第 1 项 + 图鉴页顶部统计条 §5.3.2.1） */
export interface OverviewStats {
  /** 累计打卡数（全量，不受 365 天窗口限制） */
  totalLogs: number
  totalDishes: number
  /** 当前状态为已解锁的去重菜品数（按"店铺 × 菜品"实体，PRD §5.4.1） */
  unlockedDishes: number
  avoidCount: number
  /** 近 7 天新解锁数（图鉴页"本周新增"） */
  weekNew: number
  /** 有过打卡的去重店铺数 */
  restaurantCount: number
  /** 连续打卡天数（本地自然日，从最近打卡日向前数） */
  streakDays: number
}

/** 不可变统计结果（worker 输出 / statCache 载荷） */
export interface InsightsStats {
  generatedAt: string
  windowDays: number
  windowStart: string
  windowLogCount: number
  overview: OverviewStats
  /** 近 365 天口味标签分布（维度内归一） */
  taste: DistributionPoint[]
  /** 近 365 天菜系主标签分布（cuisine.primary 单选口径，分母为已分类打卡数） */
  cuisine: DistributionPoint[]
  /** 近 365 天无主菜系的打卡条数（环形图口径透明化，UI tooltip 明示） */
  unclassifiedCuisineCount: number
  /** 口味云图 Top 20（字号/配色由本结果给出，图表层直接消费） */
  topTags: CloudTag[]
  /** 店铺均分：该店全部打卡评分算术平均、保留 1 位小数；无评分 null */
  restaurantAvg: Record<ID, number | null>
  /** 避雷库：按店铺 ID 分组 */
  avoidGroups: Record<ID, AvoidItem[]>
}
