import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Camera, Flame, MapPin, ScanLine, Star } from 'lucide-react'
import { Button, Empty, Stars } from '@/ui'
import type { Log } from '@/domain/entities'
import { getCaptureRuntime } from '@/features/capture/runtime'

interface TimelineItem {
  log: Log
  dishName: string
  restaurantName: string
}

interface HomeStats {
  logCount: number
  unlockedCount: number
  streakDays: number
}

/**
 * 首页（T1-09）：统计条（打卡/解锁/连续天数）+ 快捷入口 + 最近打卡时间线 + 空态。
 * 统计为首页展示口径（直接聚合本地仓储）；洞察页专业口径由 Agent-5 的 stats.worker 负责。
 */
export default function HomePage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<TimelineItem[]>([])
  const [stats, setStats] = useState<HomeStats>({ logCount: 0, unlockedCount: 0, streakDays: 0 })
  const [loaded, setLoaded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rt = await getCaptureRuntime()
        const logs = await rt.repos.logs.listAll(20)
        const items = await Promise.all(
          logs.map(async (log) => {
            const [dish, restaurant] = await Promise.all([
              rt.repos.dishes.get(log.dishId),
              rt.repos.restaurants.get(log.restaurantId),
            ])
            return {
              log,
              dishName: dish?.name ?? '（已删除菜品）',
              restaurantName: restaurant?.name ?? '',
            }
          }),
        )
        const allLogs = await rt.repos.logs.listAll()
        const unlocked = await rt.repos.dishes.listByFilter({ status: 'unlocked' })
        if (!alive) return
        setItems(items)
        setStats({
          logCount: allLogs.length,
          unlockedCount: unlocked.length,
          streakDays: computeStreak(allLogs.map((l) => l.ateAt)),
        })
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [reloadKey])

  // 打卡/避雷等写操作会触发数据总线事件 → 回到首页时刷新时间线
  useEffect(() => {
    const onFocus = () => setReloadKey((k) => k + 1)
    window.addEventListener('pageshow', onFocus)
    return () => window.removeEventListener('pageshow', onFocus)
  }, [])

  const isEmpty = loaded && items.length === 0

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 pb-24">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">地球 Online 美食图鉴</h1>
          <p className="text-sm text-ink-muted">把每一次吃饭，都变成一次冒险</p>
        </div>
      </header>

      {/* 统计条 */}
      <section className="grid grid-cols-3 gap-2" aria-label="打卡统计">
        <StatCard label="打卡次数" value={stats.logCount} />
        <StatCard label="解锁菜品" value={stats.unlockedCount} />
        <StatCard
          label="连续打卡"
          value={stats.streakDays}
          suffix="天"
          icon={<Flame className="h-4 w-4 text-gold" aria-hidden />}
        />
      </section>

      {/* 快捷入口 */}
      <section className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          className="h-20 flex-col gap-1"
          onClick={() => navigate('/capture')}
        >
          <Camera className="h-5 w-5" aria-hidden />
          极速打卡
        </Button>
        <Button
          variant="secondary"
          className="h-20 flex-col gap-1"
          onClick={() => navigate('/scan')}
        >
          <ScanLine className="h-5 w-5" aria-hidden />
          扫描菜单
        </Button>
      </section>

      {/* 时间线 / 空态 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-medium text-ink">最近打卡</h2>
          {items.length > 0 && (
            <Link to="/dex" className="flex items-center gap-1 text-sm text-primary">
              <BookOpen className="h-4 w-4" aria-hidden />
              进入图鉴
            </Link>
          )}
        </div>

        {isEmpty ? (
          <Empty
            title="图鉴还是空的"
            description="拍下第一道菜，开启你的美食收集之旅"
            action={
              <Button variant="primary" onClick={() => navigate('/capture')}>
                去打卡
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {items.map(({ log, dishName, restaurantName }) => (
              <li key={log.id}>
                <Link
                  to={`/dish/${log.dishId}`}
                  className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{dishName}</p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-muted">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      {restaurantName} · {formatAteAt(log.ateAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {log.manualAvoid && (
                      <span className="rounded bg-avoid/10 px-1.5 py-0.5 text-xs text-avoid">
                        避雷
                      </span>
                    )}
                    {log.rating !== null ? (
                      <Stars value={log.rating} size="sm" ariaLabel={`评分 ${log.rating}`} />
                    ) : (
                      <Star className="h-4 w-4 text-locked" aria-hidden />
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  suffix,
  icon,
}: {
  label: string
  value: number
  suffix?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-card border border-line bg-surface py-3">
      <span className="flex items-center gap-1 text-lg font-semibold text-ink">
        {icon}
        {value}
        {suffix && <span className="text-xs font-normal text-ink-muted">{suffix}</span>}
      </span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  )
}

/** / 首页（react-router lazy 约定导出） */
export function Component() {
  return <HomePage />
}

/** 连续打卡天数（首页展示口径：以本地时区日界，含今天或止于昨天即连续） */
export function computeStreak(ateAtList: string[], now = new Date()): number {
  const dayKey = (iso: string): string => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv')
  }
  const days = new Set(ateAtList.map(dayKey).filter(Boolean))
  if (days.size === 0) return 0
  const cursor = new Date(now)
  if (!days.has(cursor.toLocaleDateString('sv'))) {
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(cursor.toLocaleDateString('sv'))) return 0
  }
  let streak = 0
  while (days.has(cursor.toLocaleDateString('sv'))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function formatAteAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
