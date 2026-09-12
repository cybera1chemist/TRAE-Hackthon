import { ShieldAlert, UtensilsCrossed } from 'lucide-react'
import type { Dish } from '@/domain/entities'
import { useBlobUrl } from '@/application/data/useBlobUrl'
import { usePhoto } from '@/application/data/queries'
import { Stars } from '@/ui'
import { cn } from '@/ui/cn'

export interface DishCellProps {
  dish: Dish
  /** 跨店铺视图（全部店铺/菜系/标签）下展示店名 */
  restaurantName?: string
  coverPhotoId?: string
  /** 避雷横幅点击定位时的闪烁高亮（EC-DEX-05） */
  flashing?: boolean
  onOpen: (dish: Dish) => void
}

/**
 * 图鉴三态格子（T1-10 / PRD §5.3.2.2）：
 * - 已解锁：彩色头图（无图走中性占位）+ 菜名 + 均分；
 * - 未解锁：灰剪影 + 问号角标，菜名仍可见；
 * - 避雷：红色描边 + 红色避雷角标（任何筛选下都不折叠）。
 */
export function DishCell({ dish, restaurantName, coverPhotoId, flashing, onOpen }: DishCellProps) {
  const locked = dish.status === 'locked'
  const { data: photo } = usePhoto(locked ? undefined : coverPhotoId)
  const url = useBlobUrl(locked ? null : photo?.blobKey)

  return (
    <button
      type="button"
      onClick={() => onOpen(dish)}
      aria-label={`${dish.name}${locked ? '（未解锁）' : ''}${dish.isAvoid ? '（避雷）' : ''}`}
      className={cn(
        'group flex w-full flex-col gap-1 rounded-card p-0 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        flashing && 'animate-pulse ring-2 ring-gold',
      )}
    >
      <div
        className={cn(
          'relative aspect-square w-full overflow-hidden rounded-card border bg-surface-2',
          dish.isAvoid ? 'border-avoid ring-1 ring-avoid' : 'border-line',
        )}
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            className={cn('h-full w-full object-cover', locked && 'opacity-60 grayscale')}
          />
        ) : (
          <div
            className={cn(
              'flex h-full w-full items-center justify-center',
              locked ? 'bg-locked/15' : 'bg-gradient-to-br from-surface-2 to-surface',
            )}
          >
            <UtensilsCrossed
              className={cn('h-8 w-8', locked ? 'text-locked' : 'text-ink-muted/50')}
              strokeWidth={1.5}
              aria-hidden
            />
          </div>
        )}

        {locked && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-locked text-xs font-bold text-surface shadow-sm">
            ?
          </span>
        )}
        {dish.isAvoid && (
          <span
            className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-avoid px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
            aria-label="避雷菜品"
          >
            <ShieldAlert className="h-3 w-3" aria-hidden />
            避雷
          </span>
        )}
      </div>

      <p className="line-clamp-2 text-xs leading-tight text-ink">{dish.name}</p>
      {restaurantName && (
        <p className="-mt-0.5 line-clamp-1 text-[10px] text-ink-muted">{restaurantName}</p>
      )}
      {!locked && (
        <div className="flex items-center gap-1">
          <Stars
            value={dish.stats.avgRating ?? 0}
            size="sm"
            tone={dish.isAvoid ? 'avoid' : 'default'}
          />
          {dish.stats.avgRating !== null && (
            <span className="text-[10px] tabular-nums text-ink-muted">
              {dish.stats.avgRating.toFixed(1)}
            </span>
          )}
        </div>
      )}
    </button>
  )
}
