import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft,
  Crown,
  MapPin,
  Pencil,
  Plus,
  ScanLine,
  ShieldAlert,
  Store,
  Trash2,
} from 'lucide-react'
import type { Dish, Log } from '@/domain/entities'
import {
  useAllDishes,
  useAllLogs,
  useDataBridge,
  useDeleteRestaurant,
  usePhoto,
  useRestaurant,
  useUpdateRestaurant,
} from '@/application/data/queries'
import { useBlobUrl } from '@/application/data/useBlobUrl'
import { Button, Dialog, Empty, Input, LoadingButton, Stars, Switch, useToast, cn } from '@/ui'
import { DishCell } from '@/features/dex-grid/DishCell'
import { PersistenceBanner } from '@/features/dex-grid/PersistenceBanner'
import { progressTier } from '@/features/dex-grid/model'

const FALLBACK_SECTION = '未分组'

function pickCoverPhotoId(dishes: Dish[], logs: Log[]): string | null {
  const photosByDish = new Map<string, string[]>()
  for (const log of logs) {
    if (log.photoIds.length === 0) continue
    const list = photosByDish.get(log.dishId)
    if (list) list.push(...log.photoIds)
    else photosByDish.set(log.dishId, [...log.photoIds])
  }
  const withPhoto = dishes
    .filter((d) => d.status === 'unlocked')
    .map((d) => ({ dish: d, photos: photosByDish.get(d.id) ?? [] }))
    .filter((x) => x.photos.length > 0)
  withPhoto.sort((a, b) => (b.dish.stats.avgRating ?? -1) - (a.dish.stats.avgRating ?? -1))
  return withPhoto[0]?.photos[0] ?? null
}

function Cover({ photoId }: { photoId: string | null }) {
  const { data: photo } = usePhoto(photoId)
  const url = useBlobUrl(photo?.blobKey)
  if (url) {
    return <img src={url} alt="店铺头图" className="h-full w-full object-cover" />
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface">
      <Store className="h-12 w-12 text-ink-muted/40" strokeWidth={1.2} aria-hidden />
    </div>
  )
}

export function Component() {
  useDataBridge()
  const { rid } = useParams<{ rid: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const restaurantQuery = useRestaurant(rid)
  const allDishes = useAllDishes()
  const allLogs = useAllLogs()
  const updateRestaurant = useUpdateRestaurant()
  const deleteRestaurant = useDeleteRestaurant()

  const [flashingId, setFlashingId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [keepLogs, setKeepLogs] = useState(false)
  const flashTimer = useRef<number | null>(null)

  const restaurant = restaurantQuery.data
  const dishes = useMemo(
    () => (allDishes.data ?? []).filter((d) => d.restaurantId === rid),
    [allDishes.data, rid],
  )
  const logs = useMemo(
    () => (allLogs.data ?? []).filter((l) => l.restaurantId === rid),
    [allLogs.data, rid],
  )

  const coverPhotoId = useMemo(() => pickCoverPhotoId(dishes, logs), [dishes, logs])

  const sections = useMemo(() => {
    const map = new Map<string, Dish[]>()
    for (const dish of dishes) {
      const key = dish.section?.trim() || FALLBACK_SECTION
      const list = map.get(key)
      if (list) list.push(dish)
      else map.set(key, [dish])
    }
    // 区内排序：避雷置顶 → 均分降序 → 名称
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.isAvoid !== b.isAvoid) return a.isAvoid ? -1 : 1
        const ratingDiff = (b.stats.avgRating ?? -1) - (a.stats.avgRating ?? -1)
        if (ratingDiff !== 0) return ratingDiff
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
    }
    return Array.from(map.entries())
  }, [dishes])

  const avoidDishes = useMemo(() => dishes.filter((d) => d.isAvoid), [dishes])

  if (restaurantQuery.isLoading) {
    return <div className="py-24 text-center text-sm text-ink-muted">加载中…</div>
  }
  if (!restaurant) {
    return (
      <div className="p-4">
        <Empty title="店铺不存在或已删除" description="它可能已在其他设备上被移除。" />
      </div>
    )
  }

  const unlocked = restaurant.stats.unlockedCount
  const total = restaurant.stats.dishTotal
  const tier = progressTier(unlocked, total)
  const progressPct = total > 0 ? Math.round((unlocked / total) * 100) : 0

  const flashAvoid = () => {
    const first = avoidDishes[0]
    if (!first) return
    setFlashingId(first.id)
    requestAnimationFrame(() => {
      document
        .getElementById(`dish-${first.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashingId(null), 3000)
  }

  const handleDelete = async () => {
    await deleteRestaurant.mutateAsync({ id: restaurant.id, keepLogs })
    toast({
      title: '店铺已删除',
      description: keepLogs ? '历史打卡记录已保留。' : '店铺、菜单与打卡已一并删除。',
      variant: keepLogs ? 'info' : 'success',
    })
    navigate('/dex', { replace: true })
  }

  return (
    <div className="pb-10">
      <PersistenceBanner />

      {/* 顶部导航条 */}
      <div className="sticky top-0 z-nav flex items-center gap-2 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="返回">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
          {restaurant.name}
        </h1>
        <Button variant="ghost" size="icon" onClick={() => setEditOpen(true)} aria-label="编辑店铺">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDeleteOpen(true)}
          aria-label="删除店铺"
          className="text-avoid hover:text-avoid"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 头图 */}
      <div className="relative h-44 w-full">
        <Cover photoId={coverPhotoId} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <h2 className="text-lg font-bold text-white">{restaurant.name}</h2>
          {(restaurant.city || restaurant.district) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-white/85">
              <MapPin className="h-3 w-3" aria-hidden />
              {[restaurant.city, restaurant.district].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* 均分 / 打卡 */}
      <div className="flex items-center gap-4 px-4 pt-3 text-sm">
        <span className="flex items-center gap-1.5">
          <Stars value={restaurant.stats.avgRating ?? 0} size="sm" />
          <b className="tabular-nums text-ink">{restaurant.stats.avgRating?.toFixed(1) ?? '—'}</b>
        </span>
        <span className="text-ink-muted">打卡 {restaurant.stats.logCount} 次</span>
        {tier.key === 'complete' && (
          <span className="flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold">
            <Crown className="h-3.5 w-3.5" aria-hidden />
            全图鉴制霸
          </span>
        )}
      </div>

      {/* 进度五档 */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-ink-muted">
            制霸进度 {unlocked}/{total}
          </span>
          <span className="font-medium text-primary">{tier.label}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              tier.key === 'complete' ? 'bg-gradient-to-r from-gold to-primary' : 'bg-primary',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* 操作 */}
      <div className="flex gap-2 px-4 pt-3">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/scan/${restaurant.id}`)}>
          <ScanLine className="mr-1 h-4 w-4" />
          {total === 0 ? '扫描菜单' : '更新菜单'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => navigate(`/capture?rid=${restaurant.id}`)}
        >
          <Plus className="mr-1 h-4 w-4" />
          新增打卡
        </Button>
      </div>

      {/* 避雷黄色横幅（点击定位闪烁，EC-DEX-05） */}
      {avoidDishes.length > 0 && (
        <button
          type="button"
          onClick={flashAvoid}
          className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-start gap-2 rounded-card border border-gold/60 bg-gold/10 px-3 py-2.5 text-left"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <span className="text-xs leading-relaxed text-ink">
            本店铺有 <b className="text-avoid">{avoidDishes.length}</b> 道避雷菜
            {avoidDishes.length <= 3 && `：${avoidDishes.map((d) => d.name).join('、')}`}
            ，已在菜单中红色置顶，点击定位查看。
          </span>
        </button>
      )}

      {/* 菜单分区 */}
      {dishes.length === 0 ? (
        <div className="pt-6">
          <Empty
            icon={<ScanLine className="h-10 w-10" />}
            title="还没有菜单"
            description="扫描菜单后，菜品会按分区展示并记录制霸进度。"
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(`/scan/${restaurant.id}`)}
              >
                <ScanLine className="mr-1 h-4 w-4" />
                扫描菜单
              </Button>
            }
          />
        </div>
      ) : (
        <div className="space-y-5 pt-4">
          {sections.map(([section, list]) => (
            <section key={section}>
              <h3 className="flex items-center gap-2 px-4 text-sm font-semibold text-ink">
                {section}
                <span className="text-xs font-normal text-ink-muted">{list.length}</span>
              </h3>
              <div className="mt-2 grid grid-cols-3 gap-3 px-4">
                {list.map((dish) => (
                  <div key={dish.id} id={`dish-${dish.id}`} className="scroll-mt-24">
                    <DishCell
                      dish={dish}
                      flashing={flashingId === dish.id}
                      onOpen={(d) => navigate(`/dish/${d.id}`)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* 编辑店铺 */}
      <EditRestaurantDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        defaultName={restaurant.name}
        defaultCity={restaurant.city ?? ''}
        defaultDistrict={restaurant.district ?? ''}
        saving={updateRestaurant.isPending}
        onSubmit={async (patch) => {
          await updateRestaurant.mutateAsync({ id: restaurant.id, patch })
          setEditOpen(false)
          toast({ title: '店铺信息已更新', variant: 'success' })
        }}
      />

      {/* 删除确认（EC-DEX-04：默认级联，可保留历史打卡） */}
      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="删除店铺"
        description={`将删除「${restaurant.name}」及其 ${total} 道菜品，此操作不可撤销。`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <LoadingButton
              variant="danger"
              size="sm"
              loading={deleteRestaurant.isPending}
              onClick={handleDelete}
            >
              确认删除
            </LoadingButton>
          </>
        }
      >
        <div className="py-2">
          <Switch
            label="保留历史打卡记录（菜品从菜单移除，打卡与图片仍计入统计）"
            checked={keepLogs}
            onCheckedChange={setKeepLogs}
          />
        </div>
      </Dialog>
    </div>
  )
}

function EditRestaurantDialog({
  open,
  onOpenChange,
  defaultName,
  defaultCity,
  defaultDistrict,
  saving,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultName: string
  defaultCity: string
  defaultDistrict: string
  saving: boolean
  onSubmit: (patch: { name: string; city?: string; district?: string }) => void
}) {
  const [name, setName] = useState(defaultName)
  const [city, setCity] = useState(defaultCity)
  const [district, setDistrict] = useState(defaultDistrict)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="编辑店铺"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <LoadingButton
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!name.trim()}
            onClick={() =>
              onSubmit({
                name: name.trim(),
                city: city.trim() || undefined,
                district: district.trim() || undefined,
              })
            }
          >
            保存
          </LoadingButton>
        </>
      }
    >
      <div className="space-y-3 py-2">
        <label className="block text-xs text-ink-muted">
          店铺名称
          <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
        </label>
        <label className="block text-xs text-ink-muted">
          城市
          <Input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="mt-1"
            placeholder="如：深圳"
          />
        </label>
        <label className="block text-xs text-ink-muted">
          商圈/区县
          <Input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="mt-1"
            placeholder="如：南山区"
          />
        </label>
      </div>
    </Dialog>
  )
}
