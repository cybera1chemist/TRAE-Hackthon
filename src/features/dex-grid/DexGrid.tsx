import { useLayoutEffect, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import type { Dish } from '@/domain/entities'
import { DishCell } from './DishCell'

const PAD = 16
const GAP = 12
const MIN_CELL = 96
/** 图下两行菜名（~30）+ 一行店名/星级（~18）+ 间距 */
const CAPTION_H = 56

export interface DexGridProps {
  dishes: Dish[]
  coverByDish?: ReadonlyMap<string, string>
  restaurantNameOf?: (id: string) => string | undefined
  /** 避雷横幅定位闪烁的菜品 id（EC-DEX-05） */
  flashingId?: string | null
  onOpen: (dish: Dish) => void
  className?: string
}

/**
 * 响应式 window 虚拟网格（T1-10：千条 60fps 目标）。
 * 固定行高 + 仅渲染可视行，@tanstack/react-virtual 的 window 滚动器驱动，
 * 与 AppShell 的 document 自然滚动/底部安全区兼容。
 */
export function DexGrid({
  dishes,
  coverByDish,
  restaurantNameOf,
  flashingId,
  onOpen,
  className,
}: DexGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el) return
    const update = () => {
      setWidth(el.clientWidth)
      setTop(el.getBoundingClientRect().top + window.scrollY)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const columns = Math.max(2, Math.floor((width - PAD * 2 + GAP) / (MIN_CELL + GAP)))
  const colWidth = width > 0 ? (width - PAD * 2 - GAP * (columns - 1)) / columns : MIN_CELL
  const rowHeight = colWidth + CAPTION_H
  const rowCount = Math.ceil(dishes.length / columns)

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: top,
  })

  return (
    <div ref={parentRef} className={className}>
      {width > 0 && (
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((vRow) => {
            const start = vRow.index * columns
            const rowDishes = dishes.slice(start, start + columns)
            return (
              <div
                key={vRow.key}
                data-index={vRow.index}
                ref={virtualizer.measureElement}
                className="grid"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: `${GAP}px`,
                  padding: `0 ${PAD}px ${GAP}px`,
                  height: `${rowHeight}px`,
                }}
              >
                {rowDishes.map((dish) => (
                  <DishCell
                    key={dish.id}
                    dish={dish}
                    coverPhotoId={coverByDish?.get(dish.id)}
                    restaurantName={restaurantNameOf?.(dish.restaurantId)}
                    flashing={flashingId === dish.id}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
