import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Star } from 'lucide-react'
import { cn } from './cn'
import { RATING_MAX, RATING_MIN, RATING_STEP } from '@/domain/entities/common'

export interface StarsProps {
  /** 当前评分：0–5，0.5 步长（PRD §7.5）；0 = 未评分 */
  value: number
  /** 传入则为可交互模式 */
  onChange?: (value: number) => void
  size?: 'sm' | 'md' | 'lg'
  /** 展示色调：avoid 用于避雷菜品的低分展示（红色） */
  tone?: 'default' | 'avoid'
  className?: string
  ariaLabel?: string
}

const sizeMap = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' } as const

/** 单颗星：灰底 + 按比例裁剪的填充层（支持半星） */
function StarGlyph({ fill, sizeClass, color }: { fill: number; sizeClass: string; color: string }) {
  return (
    <span className={cn('relative inline-block', sizeClass)} aria-hidden>
      <Star
        className="absolute inset-0 h-full w-full text-locked"
        fill="currentColor"
        strokeWidth={0}
      />
      {fill > 0 && (
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: `${fill * 100}%` }}
        >
          {/* 内层星标保持完整尺寸，由外层容器裁剪实现半星 */}
          <Star
            className={cn('absolute left-0 top-0', sizeClass, color)}
            fill="currentColor"
            strokeWidth={0}
          />
        </span>
      )}
    </span>
  )
}

/**
 * 星级评分（半星）：PRD §8.3 半星精度。
 * 可交互模式为 slider 语义，键盘 ←/→ 步进 0.5（不仅靠颜色传达，符合 PRD §9）。
 */
export function Stars({
  value,
  onChange,
  size = 'md',
  tone = 'default',
  className,
  ariaLabel,
}: StarsProps) {
  const interactive = Boolean(onChange)
  const trackRef = useRef<HTMLDivElement>(null)
  const sizeClass = sizeMap[size]
  const color = tone === 'avoid' ? 'text-avoid' : 'text-gold'

  const valueFromPointer = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return RATING_MIN
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
    const raw = ratio * RATING_MAX
    const snapped = Math.round(raw / RATING_STEP) * RATING_STEP
    return Math.min(Math.max(snapped, RATING_MIN), RATING_MAX)
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onChange) return
    const v = value < RATING_MIN ? RATING_MIN : value
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange(Math.min(v + RATING_STEP, RATING_MAX))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange(Math.max(v - RATING_STEP, RATING_MIN))
    }
  }

  const fillOf = (i: number) => Math.min(Math.max(value - i, 0), 1)
  const glyphs = Array.from({ length: 5 }, (_, i) => (
    <StarGlyph key={i} fill={fillOf(i)} sizeClass={sizeClass} color={color} />
  ))

  if (!interactive) {
    return (
      <div
        className={cn('inline-flex items-center gap-0.5', className)}
        role="img"
        aria-label={ariaLabel ?? `评分 ${value} / 5`}
      >
        {glyphs}
      </div>
    )
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel ?? '评分，0.5 步长'}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value}
      className={cn('inline-flex cursor-pointer touch-none items-center gap-0.5', className)}
      onPointerDown={(e) => {
        e.preventDefault()
        onChange?.(valueFromPointer(e))
      }}
      onKeyDown={handleKeyDown}
    >
      {glyphs}
    </div>
  )
}
