import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Flame, Info, Sparkles, Store, ShieldAlert, Utensils } from 'lucide-react'
import { useDataBridge, useRestaurants, useSetAvoid } from '@/application/data/queries'
import { emitDataChanged } from '@/application/data/dataBus'
import { getDataLayer } from '@/application/data/dataLayer'
import { Button, Empty, LoadingButton, useToast, cn } from '@/ui'
import { useInsightsStats } from '@/features/insights/stats/useInsightsStats'
import { computeInsights } from '@/features/insights/stats/computeStats'
import { buildDemoDataset } from '@/features/insights/stats/fixtures'
import { tasteColor } from '@/features/insights/stats/semanticColors'
import type { InsightsStats } from '@/features/insights/stats/types'
import type { BackfillProgress } from '@/infra/ai/backfill/types'
import { createBackfillDataPort } from '@/application/ai/backfillDataPort'
import { PersistenceBanner } from '@/features/dex-grid/PersistenceBanner'
import { DonutChart } from '@/features/insights/charts/DonutChart'
import { TagCloudChart } from '@/features/insights/charts/TagCloudChart'

/** 洞察解锁阈值（EC-INS-01） */
const INSIGHTS_MIN_LOGS = 5

const CUISINE_PALETTE = [
  '#E5484D',
  '#F76B1C',
  '#F5A623',
  '#30A46C',
  '#0EA5E9',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#14B8A6',
  '#84CC16',
  '#C9A24B',
  '#8A8F98',
]

function Card({
  title,
  caption,
  children,
  action,
}: {
  title: string
  caption?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {title}
          {caption && (
            <span className="text-ink-muted" title={caption}>
              <Info className="h-3.5 w-3.5" aria-label={caption} />
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center text-sm text-ink-muted">
      — {text}
    </div>
  )
}

export function Component() {
  useDataBridge()
  const navigate = useNavigate()
  const toast = useToast()
  const { stats, refreshing, source } = useInsightsStats()
  const restaurantsQuery = useRestaurants()
  const setAvoid = useSetAvoid()

  const [chartTab, setChartTab] = useState<'cloud' | 'donut'>('cloud')
  const [backfill, setBackfill] = useState<BackfillProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const restaurantMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of restaurantsQuery.data ?? []) m.set(r.id, r.name)
    return m
  }, [restaurantsQuery.data])

  // 预览模式：<5 条打卡时用夹具数据展示图表骨架（EC-INS-01，明确标注示例数据）
  const realTotal = stats?.overview.totalLogs ?? 0
  const preview: InsightsStats | null = useMemo(() => {
    if (!stats || realTotal >= INSIGHTS_MIN_LOGS) return null
    const demo = buildDemoDataset()
    return computeInsights({ logs: demo.logs, dishes: demo.dishes, now: demo.now })
  }, [stats, realTotal])

  const shown = preview ?? stats

  const runBackfill = async () => {
    if (backfill) return
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const layer = await getDataLayer()
      const { createAIProvider } = await import('@/infra/ai')
      const { runBackfillTags } = await import('@/infra/ai/backfill')
      const result = await runBackfillTags(
        {
          ai: createAIProvider(),
          data: createBackfillDataPort(layer),
          batchSize: 20,
          includeFailed: true,
        },
        controller.signal,
        (p) => setBackfill({ ...p, failedIds: [...p.failedIds] }),
      )
      emitDataChanged('log')
      toast({
        title: '历史标签补全完成',
        description: `成功 ${result.succeeded} 条${result.failed ? `，失败 ${result.failed} 条` : ''}，图表已刷新。`,
        variant: result.failed ? 'info' : 'success',
      })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        toast({ title: '已中止补全', variant: 'info' })
      } else {
        toast({
          title: '补全失败',
          description: err instanceof Error ? err.message : 'AI 通道暂不可用，请稍后重试。',
          variant: 'error',
        })
      }
    } finally {
      abortRef.current = null
      setBackfill(null)
    }
  }

  if (!shown) {
    return <div className="py-24 text-center text-sm text-ink-muted">加载洞察中…</div>
  }

  const ov = shown.overview
  const tasteItems = shown.taste.map((p) => ({ ...p, color: tasteColor(p.value) }))
  const cuisineItems = shown.cuisine.map((p, i) => ({
    ...p,
    color: CUISINE_PALETTE[i % CUISINE_PALETTE.length],
  }))
  const noTagsAtAll =
    shown.windowLogCount > 0 && shown.taste.length === 0 && shown.cuisine.length === 0
  const avoidGroups = Object.entries(shown.avoidGroups)

  const undoAvoid = async (dishId: string, name: string) => {
    await setAvoid.mutateAsync({ dishId, avoid: false })
    toast({ title: `已撤销「${name}」的避雷标记`, variant: 'success' })
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <PersistenceBanner />

      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">美食洞察</h1>
        {refreshing && source === 'fresh' && (
          <span className="text-xs text-ink-muted">更新中…</span>
        )}
        {source === 'cache' && (
          <span className="text-xs text-ink-muted" title="正在后台用最新打卡重算">
            缓存数据 · 更新中…
          </span>
        )}
      </header>

      {preview && (
        <div className="rounded-card border border-gold/60 bg-gold/10 px-4 py-3 text-xs leading-relaxed text-ink">
          已有 {realTotal} 次打卡，再打卡 <b>{Math.max(0, INSIGHTS_MIN_LOGS - realTotal)}</b>{' '}
          次即可解锁专属美食洞察。 下方图表为
          <span className="font-semibold"> 预览样式（示例数据）</span>。
        </div>
      )}

      {/* 总览卡 */}
      <div className="grid grid-cols-2 gap-3">
        <OverviewCard
          icon={<CalendarDays className="h-4 w-4 text-primary" />}
          value={ov.totalLogs}
          label="累计打卡"
        />
        <OverviewCard
          icon={<Utensils className="h-4 w-4 text-primary" />}
          value={ov.unlockedDishes}
          label="已解锁菜品"
        />
        <OverviewCard
          icon={<Store className="h-4 w-4 text-primary" />}
          value={ov.restaurantCount}
          label="打卡店铺"
        />
        <OverviewCard
          icon={<Flame className="h-4 w-4 text-gold" />}
          value={ov.streakDays}
          label="连续打卡天数"
        />
      </div>

      {/* 口味：云图 / 环形切换 */}
      <Card
        title="口味画像"
        caption="统计近 365 个自然日内的口味标签，同维度内归一为 100%；点击可下钻到图鉴。"
        action={
          !preview && shown.taste.length > 0 ? (
            <div className="flex rounded-full border border-line p-0.5 text-xs">
              {(['cloud', 'donut'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setChartTab(tab)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5',
                    chartTab === tab ? 'bg-primary text-primary-fg' : 'text-ink-muted',
                  )}
                >
                  {tab === 'cloud' ? '标签云' : '环形图'}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        {shown.taste.length === 0 ? (
          <EmptyChart text={preview ? '示例数据无口味标签' : '近 365 天还没有口味标签'} />
        ) : chartTab === 'cloud' ? (
          <TagCloudChart
            tags={shown.topTags}
            caption="口味标签出现次数 · 近 365 天"
            onTagClick={
              preview ? undefined : (v) => navigate(`/dex?view=tag&t=${encodeURIComponent(v)}`)
            }
          />
        ) : (
          <DonutChart
            items={tasteItems}
            caption="口味标签 · 近 365 天 · 维度内归一"
            centerLabel="打卡数"
            onItemClick={
              preview ? undefined : (v) => navigate(`/dex?view=tag&t=${encodeURIComponent(v)}`)
            }
          />
        )}
      </Card>

      {/* 菜系环形图（口径独立） */}
      <Card
        title="菜系分布"
        caption="每道菜只取第一个菜系标签（cuisine.primary），分母为近 365 天已分类打卡数；无菜系标签的打卡不计入占比。"
      >
        {shown.cuisine.length === 0 ? (
          <EmptyChart text={preview ? '示例数据无菜系标签' : '近 365 天还没有菜系标签'} />
        ) : (
          <>
            <DonutChart
              items={cuisineItems}
              caption="主菜系 · 近 365 天 · 分母为已分类打卡"
              centerLabel="已分类"
              onItemClick={
                preview
                  ? undefined
                  : (v) => navigate(`/dex?view=cuisine&g=${encodeURIComponent(v)}`)
              }
            />
            {shown.unclassifiedCuisineCount > 0 && (
              <p className="text-center text-xs text-ink-muted">
                另有 {shown.unclassifiedCuisineCount} 条打卡无菜系标签，未计入占比
              </p>
            )}
          </>
        )}
      </Card>

      {/* EC-INS-02：全量无标签时的一键补全 CTA */}
      {!preview && noTagsAtAll && (
        <div className="rounded-card border border-dashed border-primary/60 bg-primary/5 p-4 text-center">
          <Sparkles className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-medium text-ink">让 AI 补全历史打卡标签</p>
          <p className="mt-1 text-xs text-ink-muted">
            根据菜名、短评与照片批量提取口味/菜系标签，完成后图表自动刷新。
          </p>
          {backfill ? (
            <div className="mt-3 space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${backfill.total ? Math.round((backfill.processed / backfill.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="text-xs text-ink-muted">
                处理中 {backfill.processed}/{backfill.total}（成功 {backfill.succeeded} · 失败{' '}
                {backfill.failed}）
              </p>
              <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
                中止
              </Button>
            </div>
          ) : (
            <LoadingButton
              variant="primary"
              size="sm"
              className="mt-3"
              loading={false}
              onClick={runBackfill}
            >
              一键补全历史标签
            </LoadingButton>
          )}
        </div>
      )}

      {/* 避雷库（T4-03：按店分组、短评、撤销即时生效；预览态仅展示示例图表，不渲染可交互列表） */}
      {!preview && (
        <Card
          title="避雷库"
          caption="手动标记或评分 ≤2 的菜品自动进入避雷库，会在店铺横幅、搜索与打卡前提醒中联动提示。"
        >
          {avoidGroups.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              <ShieldAlert className="mx-auto mb-2 h-8 w-8 opacity-40" />
              还没有避雷菜品
            </p>
          ) : (
            <div className="space-y-4">
              {avoidGroups.map(([rid, items]) => (
                <div key={rid}>
                  <button
                    type="button"
                    onClick={() => navigate(`/restaurant/${rid}`)}
                    className="mb-1.5 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <Store className="h-3.5 w-3.5" />
                    {restaurantMap.get(rid) ?? '未知店铺'}
                    <span className="text-ink-muted">{items.length} 道</span>
                  </button>
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li
                        key={item.dishId}
                        className="flex items-start justify-between gap-3 rounded-card bg-surface-2 px-3 py-2"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => navigate(`/dish/${item.dishId}`)}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm text-ink">{item.name}</span>
                            {item.manualOnly && (
                              <span className="shrink-0 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] text-gold">
                                手标
                              </span>
                            )}
                            {item.latestLowRating !== null && (
                              <span className="shrink-0 text-xs font-medium text-avoid">
                                {item.latestLowRating.toFixed(1)} 分
                              </span>
                            )}
                          </span>
                          {item.comment && (
                            <span className="mt-0.5 line-clamp-2 block text-xs text-ink-muted">
                              “{item.comment}”
                            </span>
                          )}
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-0.5 h-8 shrink-0 px-2 text-xs text-ink-muted"
                          disabled={setAvoid.isPending}
                          onClick={() => undoAvoid(item.dishId, item.name)}
                        >
                          撤销
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {preview && (
        <Empty
          icon={<Sparkles className="h-10 w-10" />}
          title="专属洞察未解锁"
          description={`再完成 ${Math.max(0, INSIGHTS_MIN_LOGS - realTotal)} 次打卡，即可生成你的口味画像、菜系分布与避雷库。`}
        />
      )}
    </div>
  )
}

function OverviewCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode
  value: number
  label: string
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">{value}</p>
    </div>
  )
}
