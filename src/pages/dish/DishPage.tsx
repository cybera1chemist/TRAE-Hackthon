import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ImageIcon, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import {
  useDeleteLog,
  useDish,
  useDishLogs,
  useDataBridge,
  usePhoto,
  useRestaurant,
  useSetAvoid,
} from '@/application/data/queries'
import { getDataLayer } from '@/application/data/dataLayer'
import { useBlobUrl } from '@/application/data/useBlobUrl'
import { Button, Dialog, Empty, LoadingButton, Stars, Switch, useToast, cn } from '@/ui'
import { PersistenceBanner } from '@/features/dex-grid/PersistenceBanner'
import { primaryCuisine } from '@/features/dex-grid/model'
import type { Log } from '@/domain/entities'

function GalleryImage({ photoId }: { photoId: string }) {
  const { data: photo } = usePhoto(photoId)
  const url = useBlobUrl(photo?.blobKey)
  if (!url) {
    return (
      <div className="flex h-full w-full shrink-0 items-center justify-center bg-surface-2">
        <ImageIcon className="h-6 w-6 text-ink-muted/50" />
      </div>
    )
  }
  return (
    <img src={url} alt="打卡照片" loading="lazy" className="h-full w-full shrink-0 object-cover" />
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`
}

export function Component() {
  useDataBridge()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const dishQuery = useDish(id)
  const restaurantQuery = useRestaurant(dishQuery.data?.restaurantId)
  const logsQuery = useDishLogs(id)
  const deleteLog = useDeleteLog()
  const setAvoid = useSetAvoid()

  const [pendingDelete, setPendingDelete] = useState<Log | null>(null)

  const dish = dishQuery.data
  const restaurant = restaurantQuery.data
  const logs = useMemo(
    () => [...(logsQuery.data ?? [])].sort((a, b) => b.ateAt.localeCompare(a.ateAt)),
    [logsQuery.data],
  )

  const galleryIds = useMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const log of logs) {
      for (const pid of log.photoIds) {
        if (!seen.has(pid)) {
          seen.add(pid)
          ids.push(pid)
        }
      }
    }
    return ids
  }, [logs])

  if (dishQuery.isLoading) {
    return <div className="py-24 text-center text-sm text-ink-muted">加载中…</div>
  }
  if (!dish) {
    return (
      <div className="p-4">
        <Empty title="菜品不存在" description="它可能已随店铺删除被移除。" />
      </div>
    )
  }

  const locked = dish.status === 'locked'
  const cuisine = primaryCuisine(dish)
  const otherTags = dish.tags.filter((t) => t.dim !== 'cuisine')

  const handleToggleAvoid = async (next: boolean) => {
    await setAvoid.mutateAsync({ dishId: dish.id, avoid: next })
    toast({
      title: next ? '已标记为避雷' : '已撤销避雷',
      description: next ? '店铺横幅、搜索与洞察页将同步提示。' : '该菜品已恢复正常展示。',
      variant: next ? 'info' : 'success',
    })
  }

  const handleDeleteLog = async () => {
    if (!pendingDelete) return
    const wasUnlocked = dish.status === 'unlocked'
    const target = pendingDelete
    setPendingDelete(null)
    await deleteLog.mutateAsync(target.id)
    // EC-DEX-03：回退为未解锁时明确提示
    if (wasUnlocked) {
      const layer = await getDataLayer()
      const fresh = await layer.repos.dishes.get(dish.id)
      if (fresh?.status === 'locked') {
        toast({
          title: '打卡已删除',
          description: '该菜品已无有效打卡，回退为未解锁状态。',
          variant: 'info',
        })
        return
      }
    }
    toast({ title: '打卡已删除', variant: 'success' })
  }

  return (
    <div className="pb-10">
      <PersistenceBanner />

      <div className="sticky top-0 z-nav flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="返回">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{dish.name}</h1>
      </div>

      {/* 图片画廊 */}
      {galleryIds.length > 0 ? (
        <div className="flex aspect-[4/3] w-full snap-x snap-mandatory overflow-x-auto bg-surface-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {galleryIds.map((pid) => (
            <div key={pid} className="h-full w-full snap-center">
              <GalleryImage photoId={pid} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-surface-2 text-ink-muted">
          <ImageIcon className="h-10 w-10 opacity-50" strokeWidth={1.2} />
          <span className="text-xs">还没有打卡照片</span>
        </div>
      )}

      <div className="space-y-4 px-4 pt-4">
        {/* 标题区 */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-ink">{dish.name}</h2>
            {locked && (
              <span className="rounded-full bg-locked/15 px-2 py-0.5 text-xs text-locked">
                未解锁
              </span>
            )}
            {dish.isAvoid && (
              <span className="flex items-center gap-1 rounded-full bg-avoid/10 px-2 py-0.5 text-xs text-avoid">
                <ShieldAlert className="h-3.5 w-3.5" />
                避雷
              </span>
            )}
          </div>
          {restaurant && (
            <button
              type="button"
              onClick={() => navigate(`/restaurant/${restaurant.id}`)}
              className="mt-1 flex items-center gap-0.5 text-sm text-primary hover:underline"
            >
              {restaurant.name}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {/* 评分汇总 */}
        <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-3">
          <div>
            <p className="text-[10px] text-ink-muted">我的均分</p>
            <p className="text-lg font-bold tabular-nums text-ink">
              {dish.stats.avgRating !== null ? dish.stats.avgRating.toFixed(1) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-ink-muted">最近评分</p>
            <Stars value={dish.stats.latestRating ?? 0} size="sm" />
          </div>
          <div>
            <p className="text-[10px] text-ink-muted">打卡次数</p>
            <p className="text-lg font-bold tabular-nums text-ink">{dish.stats.logCount}</p>
          </div>
        </div>

        {/* 标签 */}
        {(cuisine || otherTags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {cuisine && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {cuisine}
              </span>
            )}
            {otherTags.map((t) => (
              <span
                key={`${t.dim}:${t.value}`}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted"
              >
                {t.value}
              </span>
            ))}
          </div>
        )}

        {/* 操作 */}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              navigate(`/capture?dish=${dish.id}${restaurant ? `&rid=${restaurant.id}` : ''}`)
            }
          >
            <Plus className="h-4 w-4" />
            追加打卡
          </Button>
          {dish.section && <span className="text-xs text-ink-muted">分区：{dish.section}</span>}
        </div>

        <div className="rounded-card border border-line p-3">
          <Switch
            label={dish.isAvoid ? '已标记为避雷（点击撤销）' : '标记为避雷菜'}
            checked={dish.isAvoid}
            onCheckedChange={handleToggleAvoid}
          />
        </div>

        {/* Log 时间线 */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">打卡记录</h3>
          {logs.length === 0 ? (
            <Empty
              icon={<ImageIcon className="h-10 w-10" />}
              title="还没有打卡记录"
              description="完成第一次打卡，记录评分、短评与照片。"
            />
          ) : (
            <ol className="relative space-y-3 border-l border-line pl-4">
              {logs.map((log) => (
                <li key={log.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-surface" />
                  <div className="rounded-card border border-line bg-surface p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-muted">{formatTime(log.ateAt)}</span>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(log)}
                        className="flex items-center gap-1 text-xs text-ink-muted transition hover:text-avoid"
                        aria-label="删除该打卡"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Stars
                        value={log.rating ?? 0}
                        size="sm"
                        tone={log.rating !== null && log.rating <= 2 ? 'avoid' : 'default'}
                      />
                      {log.manualAvoid && (
                        <span className="flex items-center gap-0.5 rounded-full bg-avoid/10 px-1.5 py-0.5 text-[10px] text-avoid">
                          <ShieldAlert className="h-3 w-3" />
                          手动避雷
                        </span>
                      )}
                      {log.price != null && (
                        <span className="text-xs tabular-nums text-ink-muted">¥{log.price}</span>
                      )}
                      {log.scene && <span className="text-xs text-ink-muted">{log.scene}</span>}
                    </div>
                    {log.comment && (
                      <p className={cn('mt-1.5 text-sm leading-relaxed text-ink')}>{log.comment}</p>
                    )}
                    {log.photoIds.length > 0 && (
                      <div className="mt-2 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {log.photoIds.slice(0, 6).map((pid) => (
                          <div key={pid} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
                            <GalleryImage photoId={pid} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* 删除打卡确认（EC-DEX-03：删除后联动重算，可能回退未解锁） */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
        title="删除这条打卡？"
        description="评分、短评与照片引用将一并移除，菜品统计会立即重算；若因此没有有效打卡，菜品将回退为未解锁。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <LoadingButton
              variant="danger"
              size="sm"
              loading={deleteLog.isPending}
              onClick={handleDeleteLog}
            >
              删除
            </LoadingButton>
          </>
        }
      />
    </div>
  )
}
