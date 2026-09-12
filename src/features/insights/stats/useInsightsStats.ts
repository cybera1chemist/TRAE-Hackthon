/**
 * 洞察统计 SWR hook（T4-01 / TDD §3.5）。
 *
 * 策略：先渲染 statCache 缓存（或会话内最近结果）→ 后台拉全量快照 →
 * stats.worker 重算（不支持则主线程降级）→ 回写缓存并替换视图。
 * 写事务经 dataBus 广播后自动触发后台重算；重复挂载会话内零延迟。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDataLayer } from '@/application/data/dataLayer'
import { subscribeDataChanged } from '@/application/data/dataBus'
import { readStatsCache, snapshotHash, writeStatsCache } from './statsCache'
import { createStatsClient, type StatsClient } from './statsClient'
import type { InsightsStats } from './types'

let clientSingleton: StatsClient | null = null
function getClient(): StatsClient {
  clientSingleton ??= createStatsClient()
  return clientSingleton
}

/** 会话内最近一次结果（跨路由返回时零延迟，仍会后台校验新鲜度） */
let memoryFresh: InsightsStats | null = null

export interface InsightsStatsState {
  stats: InsightsStats | null
  /** 后台重算进行中（首次加载也为 true） */
  refreshing: boolean
  /** 当前展示数据来源：cache=持久化缓存，fresh=本次会话重算 */
  source: 'cache' | 'fresh' | null
  error: Error | null
}

export function useInsightsStats(): InsightsStatsState & { refresh: () => void } {
  const [state, setState] = useState<InsightsStatsState>({
    stats: memoryFresh,
    refreshing: memoryFresh === null,
    source: memoryFresh ? 'fresh' : null,
    error: null,
  })
  const signalRef = useRef(0)

  const run = useCallback(async () => {
    const runId = ++signalRef.current
    setState((prev) => ({ ...prev, refreshing: true, error: null }))
    try {
      const layer = await getDataLayer()

      // 1) SWR 的 stale：缓存（会话内已有新鲜结果时跳过持久缓存读取）
      if (!memoryFresh) {
        const cached = await readStatsCache(layer)
        if (cached && runId === signalRef.current) {
          setState({ stats: cached.data, refreshing: true, source: 'cache', error: null })
        }
      }

      // 2) 拉全量快照（Log 全量 + Dish 全量）
      const [logs, dishes] = await Promise.all([
        layer.repos.logs.listAll(1_000_000),
        layer.repos.dishes.listByFilter({}),
      ])
      const snapshot = { logs, dishes }

      // 3) worker 重算（降级路径在 client 内部）
      const result = await getClient().compute(snapshot)
      if (runId !== signalRef.current) return

      // 4) 回写缓存并刷新
      memoryFresh = result
      await writeStatsCache(layer, result, snapshotHash({ logs, dishes }))
      if (runId === signalRef.current) {
        setState({ stats: result, refreshing: false, source: 'fresh', error: null })
      }
    } catch (err) {
      if (runId === signalRef.current) {
        setState((prev) => ({
          ...prev,
          refreshing: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }))
      }
    }
  }, [])

  useEffect(() => {
    void run()
    // 打卡/避雷/店铺等写事务成功后后台重算
    const unsubscribe = subscribeDataChanged((scope) => {
      if (scope === 'dish' || scope === 'log' || scope === 'restaurant' || scope === 'all')
        void run()
    })
    return unsubscribe
  }, [run])

  return { ...state, refresh: run }
}

/** 测试专用：清会话内存结果 */
export function resetInsightsStatsMemoryForTest(): void {
  memoryFresh = null
}
