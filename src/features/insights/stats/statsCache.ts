/**
 * statCache 读写（T4-01 / TDD §3.5）。
 *
 * - 复用 Agent-1 Dexie schema v1 的 key/value 表 statCache；
 * - key 含口径版本，dataVersion 随口径变更递增，旧缓存自动作废；
 * - memory 降级模式（无 db）下缓存为空操作，不影响 SWR 主流程；
 * - hash 为快照签名，仅用于判断后台重算结果是否有变化（避免无谓写入）。
 */
import type { DataLayer } from '@/infra/db'
import type { InsightsStats, StatsSnapshot } from './types'

/** 口径版本：computeStats 口径变化时 +1（PRD/TDD 变更记录同步） */
export const STATS_DATA_VERSION = 1
export const STATS_CACHE_KEY = `insights:v${STATS_DATA_VERSION}`

export interface CachedStats {
  data: InsightsStats
  hash: string
  updatedAt: string
}

/** 快照签名：条数 + 最新时间戳（成本 O(n)，千条级无感） */
export function snapshotHash(s: StatsSnapshot): string {
  let maxLog = ''
  for (const l of s.logs) if (l.ateAt > maxLog) maxLog = l.ateAt
  let maxDish = ''
  for (const d of s.dishes) if (d.updatedAt > maxDish) maxDish = d.updatedAt
  return `${s.logs.length}:${maxLog}|${s.dishes.length}:${maxDish}`
}

export async function readStatsCache(layer: DataLayer): Promise<CachedStats | null> {
  if (!layer.db) return null
  try {
    const rec = await layer.db.statCache.get(STATS_CACHE_KEY)
    if (!rec || rec.dataVersion !== STATS_DATA_VERSION) return null
    return {
      data: rec.data as InsightsStats,
      hash: rec.hash ?? '',
      updatedAt: rec.updatedAt,
    }
  } catch {
    return null
  }
}

export async function writeStatsCache(
  layer: DataLayer,
  data: InsightsStats,
  hash: string,
): Promise<void> {
  if (!layer.db) return
  try {
    await layer.db.statCache.put({
      key: STATS_CACHE_KEY,
      data,
      dataVersion: STATS_DATA_VERSION,
      hash,
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // 缓存写入失败不影响洞察渲染
  }
}

export async function clearStatsCache(layer: DataLayer): Promise<void> {
  if (!layer.db) return
  try {
    await layer.db.statCache.delete(STATS_CACHE_KEY)
  } catch {
    // ignore
  }
}
