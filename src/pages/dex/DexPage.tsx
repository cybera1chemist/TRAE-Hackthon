import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera, ChevronDown, Search, ShieldAlert, X } from 'lucide-react'
import type { Dish, Restaurant } from '@/domain/entities'
import { useAllDishes, useAllLogs, useDataBridge, useRestaurants } from '@/application/data/queries'
import { getDataLayer } from '@/application/data/dataLayer'
import { Empty, Input, cn } from '@/ui'
import { tasteColor } from '@/features/insights/stats/semanticColors'
import { PersistenceBanner } from '@/features/dex-grid/PersistenceBanner'
import { DexGrid } from '@/features/dex-grid/DexGrid'
import {
  applyQuickFilter,
  applyViewGroup,
  buildDexHeaderStats,
  buildFilterContext,
  collectCuisines,
  collectTags,
  parseDexQuery,
  searchDishes,
  serializeDexQuery,
  type DexQueryState,
  type DexQuickFilter,
  type DexSort,
  type DexView,
} from '@/features/dex-grid/model'

const VIEW_TABS: Array<{ key: DexView; label: string }> = [
  { key: 'restaurant', label: '按店铺' },
  { key: 'cuisine', label: '按菜系' },
  { key: 'tag', label: '按标签' },
]

const FILTER_CHIPS: Array<{ key: DexQuickFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'locked', label: '未解锁' },
  { key: 'avoid', label: '避雷' },
  { key: 'high', label: '高分 ≥4' },
  { key: 'photo', label: '有图' },
  { key: 'recent', label: '近 7 天' },
]

const SORT_LABELS: Record<DexSort, string> = {
  recent: '最近更新',
  unlocked: '最近解锁',
  rating: '评分最高',
  name: '名称',
}

function Loading() {
  return <div className="py-24 text-center text-sm text-ink-muted">加载图鉴中…</div>
}

export function Component() {
  useDataBridge()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const state = useMemo<DexQueryState>(() => parseDexQuery(params), [params])

  const dishesQuery = useAllDishes()
  const restaurantsQuery = useRestaurants()
  const logsQuery = useAllLogs()

  const [searchDraft, setSearchDraft] = useState(state.q)

  const patchState = (patch: Partial<DexQueryState>) => {
    const next = { ...state, ...patch }
    setParams(serializeDexQuery(next), { replace: true })
  }

  const dishes = useMemo(() => dishesQuery.data ?? [], [dishesQuery.data])
  const restaurants = useMemo(() => restaurantsQuery.data ?? [], [restaurantsQuery.data])
  const logs = useMemo(() => logsQuery.data ?? [], [logsQuery.data])

  const restaurantMap = useMemo(() => {
    const m = new Map<string, Restaurant>()
    for (const r of restaurants) m.set(r.id, r)
    return m
  }, [restaurants])

  const ctx = useMemo(() => buildFilterContext(logs), [logs])
  const headerStats = useMemo(() => buildDexHeaderStats(dishes), [dishes])

  const cuisines = useMemo(() => collectCuisines(dishes), [dishes])
  const tags = useMemo(() => collectTags(dishes), [dishes])
  const unclassifiedCount = useMemo(
    () => dishes.filter((d) => d.tags.every((t) => t.dim !== 'cuisine')).length,
    [dishes],
  )

  const visibleDishes = useMemo(() => {
    const grouped = applyViewGroup(dishes, state)
    const filtered = applyQuickFilter(grouped, state.filter, ctx)
    return sortDishList(filtered, state.sort)
  }, [dishes, state, ctx])

  if (dishesQuery.isLoading || restaurantsQuery.isLoading) return <Loading />

  // ── 全局搜索结果模式（T4-06） ──
  if (state.q.trim()) {
    return (
      <SearchResults
        q={state.q}
        allDishes={dishes}
        restaurantMap={restaurantMap}
        draft={searchDraft}
        onDraftChange={(v) => {
          setSearchDraft(v)
          patchState({ q: v })
        }}
        onClear={() => {
          setSearchDraft('')
          patchState({ q: '' })
        }}
        onOpenDish={(d) => navigate(`/dish/${d.id}`)}
        onOpenRestaurant={(r) => navigate(`/restaurant/${r.id}`)}
      />
    )
  }

  return (
    <div className="pb-4">
      <PersistenceBanner />

      <header className="px-4 pt-4">
        <h1 className="text-xl font-bold text-ink">美食图鉴</h1>
        <div className="mt-3 flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <Input
            value={searchDraft}
            onChange={(e) => {
              const v = e.target.value
              setSearchDraft(v)
              patchState({ q: v })
            }}
            placeholder="搜索店铺或菜品…"
            className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            aria-label="全局搜索"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={() => {
                setSearchDraft('')
                patchState({ q: '' })
              }}
              aria-label="清空搜索"
              className="text-ink-muted hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>
            已解锁 <b className="text-primary">{headerStats.unlocked}</b> / {headerStats.total}
          </span>
          <span>
            避雷 <b className="text-avoid">{headerStats.avoid}</b>
          </span>
          <span>
            本周新增 <b className="text-ink">{headerStats.weekNew}</b>
          </span>
        </div>
      </header>

      {/* 三视图 Tab */}
      <div className="sticky top-0 z-nav mt-3 flex gap-1 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => patchState({ view: tab.key, group: '', tag: '' })}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm transition',
              state.view === tab.key
                ? 'bg-primary font-medium text-primary-fg'
                : 'text-ink-muted hover:text-ink',
            )}
            aria-pressed={state.view === tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 分组选择 */}
      {state.view === 'restaurant' && (
        <ChipRow
          chips={[
            { key: '', label: '全部店铺' },
            ...restaurants.map((r) => ({ key: r.id, label: r.name })),
          ]}
          active={state.group}
          onSelect={(g) => patchState({ group: g })}
        />
      )}
      {state.view === 'cuisine' && (
        <ChipRow
          chips={[
            { key: '', label: '全部菜系' },
            ...cuisines.map((c) => ({ key: c.value, label: `${c.value} ${c.count}` })),
            ...(unclassifiedCount > 0
              ? [{ key: '__unclassified__', label: `未分类 ${unclassifiedCount}` }]
              : []),
          ]}
          active={state.group}
          onSelect={(g) => patchState({ group: g })}
        />
      )}
      {state.view === 'tag' && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => patchState({ tag: '' })}
            className={cn(
              'shrink-0 rounded-full border px-2.5 py-1 text-xs',
              state.tag === ''
                ? 'border-primary bg-primary text-primary-fg'
                : 'border-line text-ink-muted',
            )}
          >
            全部标签
          </button>
          {tags.map((t) => (
            <button
              key={`${t.dim}:${t.value}`}
              type="button"
              onClick={() => patchState({ tag: t.value })}
              className="shrink-0 rounded-full border border-line px-2.5 py-1 leading-none transition"
              style={{
                fontSize: `${Math.min(12 + Math.sqrt(t.count) * 2, 20)}px`,
                color:
                  state.tag === t.value
                    ? undefined
                    : t.dim === 'taste'
                      ? tasteColor(t.value)
                      : undefined,
                backgroundColor: state.tag === t.value ? 'var(--color-primary)' : undefined,
              }}
              aria-pressed={state.tag === t.value}
            >
              {t.value}
              <span className="ml-1 text-[10px] opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* 快捷筛选 + 排序 */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTER_CHIPS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => patchState({ filter: f.key })}
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1 text-xs transition',
                state.filter === f.key
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'border-line text-ink-muted',
                f.key === 'avoid' &&
                  state.filter === 'avoid' &&
                  'border-avoid bg-avoid/10 text-avoid',
              )}
              aria-pressed={state.filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative shrink-0">
          <span className="sr-only">排序方式</span>
          <select
            value={state.sort}
            onChange={(e) => patchState({ sort: e.target.value as DexSort })}
            className="h-8 appearance-none rounded-full border border-line bg-surface pl-3 pr-7 text-xs text-ink"
          >
            {(Object.keys(SORT_LABELS) as DexSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
        </label>
      </div>

      {dishes.length === 0 ? (
        <Empty
          icon={<Camera className="h-10 w-10" />}
          title="图鉴还是空的"
          description="扫描菜单或完成一次打卡，开启你的美食图鉴。"
          action={
            <button
              type="button"
              onClick={() => navigate('/scan')}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-fg"
            >
              扫描第一份菜单
            </button>
          }
        />
      ) : visibleDishes.length === 0 ? (
        <Empty
          icon={<Search className="h-10 w-10" />}
          title="没有符合条件的菜品"
          description="换个筛选或排序试试。"
        />
      ) : (
        <>
          <p className="px-4 pb-2 text-xs text-ink-muted">共 {visibleDishes.length} 道</p>
          <DexGrid
            dishes={visibleDishes}
            coverByDish={ctx.coverByDish}
            restaurantNameOf={(rid) => (state.group ? undefined : restaurantMap.get(rid)?.name)}
            onOpen={(d) => navigate(`/dish/${d.id}`)}
          />
        </>
      )}
    </div>
  )
}

function sortDishList(list: Dish[], sort: DexSort): Dish[] {
  const dir = sort === 'name' ? 1 : -1
  return [...list].sort((a, b) => {
    if (sort === 'name') return dir * a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (sort === 'rating') return dir * ((a.stats.avgRating ?? -1) - (b.stats.avgRating ?? -1))
    if (sort === 'unlocked') return dir * (a.unlockedAt ?? '').localeCompare(b.unlockedAt ?? '')
    return dir * a.updatedAt.localeCompare(b.updatedAt)
  })
}

function ChipRow({
  chips,
  active,
  onSelect,
}: {
  chips: Array<{ key: string; label: string }>
  active: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          className={cn(
            'shrink-0 rounded-full border px-3 py-1 text-xs transition',
            active === c.key
              ? 'border-primary bg-primary font-medium text-primary-fg'
              : 'border-line text-ink-muted',
          )}
          aria-pressed={active === c.key}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

// ── 搜索结果（T4-06：店铺/菜品双分区，避雷角标不折叠，本地 ≤100ms） ──────────

function SearchResults({
  q,
  allDishes,
  restaurantMap,
  draft,
  onDraftChange,
  onClear,
  onOpenDish,
  onOpenRestaurant,
}: {
  q: string
  allDishes: Dish[]
  restaurantMap: Map<string, Restaurant>
  draft: string
  onDraftChange: (v: string) => void
  onClear: () => void
  onOpenDish: (d: Dish) => void
  onOpenRestaurant: (r: Restaurant) => void
}) {
  const dishResults = useMemo(() => searchDishes(allDishes, q).slice(0, 100), [allDishes, q])

  const restaurantQuery = useQuery({
    queryKey: ['restaurant-search', q.trim().toLowerCase()],
    queryFn: async () => {
      const layer = await getDataLayer()
      return layer.repos.restaurants.search(q, 20)
    },
    staleTime: 60_000,
  })
  const restaurantResults = restaurantQuery.data ?? []

  return (
    <div className="pb-6">
      <header className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <Input
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="搜索店铺或菜品…"
            className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            aria-label="全局搜索"
          />
          <button
            type="button"
            onClick={onClear}
            aria-label="清空搜索"
            className="text-ink-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <p className="px-4 pt-3 text-xs text-ink-muted">
        店铺 {restaurantResults.length} · 菜品 {dishResults.length}
      </p>

      {restaurantResults.length > 0 && (
        <section className="mt-2">
          <h2 className="px-4 pb-1 text-xs font-medium text-ink-muted">店铺</h2>
          {restaurantResults.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpenRestaurant(r)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"
            >
              <span>
                <span className="block text-sm text-ink">{r.name}</span>
                <span className="block text-xs text-ink-muted">
                  {[r.city, r.district].filter(Boolean).join(' · ') || '暂无地区信息'}
                </span>
              </span>
              {r.stats.avoidCount > 0 && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-avoid/10 px-2 py-0.5 text-xs text-avoid">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                  避雷 {r.stats.avoidCount}
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      {dishResults.length > 0 && (
        <section className="mt-2">
          <h2 className="px-4 pb-1 text-xs font-medium text-ink-muted">菜品</h2>
          {dishResults.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpenDish(d)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{d.name}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {restaurantMap.get(d.restaurantId)?.name ?? '未知店铺'}
                  {d.stats.avgRating !== null ? ` · ${d.stats.avgRating.toFixed(1)} 分` : ''}
                </span>
              </span>
              {d.isAvoid && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-avoid/10 px-2 py-0.5 text-xs text-avoid">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                  避雷
                </span>
              )}
            </button>
          ))}
        </section>
      )}

      {restaurantResults.length === 0 && dishResults.length === 0 && (
        <Empty
          icon={<Search className="h-10 w-10" />}
          title="没有匹配结果"
          description="试试店名、菜名或别名关键词。"
        />
      )}
    </div>
  )
}
