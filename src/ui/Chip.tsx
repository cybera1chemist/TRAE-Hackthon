import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'

export type ChipTone = 'default' | 'gold' | 'avoid' | 'ai'

export interface ChipProps {
  children: ReactNode
  /** 选中态（可多选筛选/标签勾选） */
  selected?: boolean
  tone?: ChipTone
  onClick?: () => void
  /** 传入则渲染右侧删除按钮（标签改删） */
  onRemove?: () => void
  disabled?: boolean
  className?: string
  /** 无障碍描述（如“AI 建议：麻辣 93%”） */
  ariaLabel?: string
}

const toneStyles: Record<ChipTone, { base: string; selected: string }> = {
  default: {
    base: 'border-line bg-surface text-ink',
    selected: 'border-primary bg-primary/10 text-primary',
  },
  gold: {
    base: 'border-gold/40 bg-gold/10 text-gold',
    selected: 'border-gold bg-gold/20 text-gold',
  },
  avoid: {
    base: 'border-avoid/40 bg-avoid/10 text-avoid',
    selected: 'border-avoid bg-avoid/20 text-avoid',
  },
  ai: {
    base: 'border-neon-cyan/40 bg-neon-cyan/10 text-ink',
    selected: 'border-neon-cyan bg-neon-cyan/20 text-ink',
  },
}

/** 标签/筛选 Chip（标签确认、图鉴筛选、AI 建议展示通用） */
export function Chip({
  children,
  selected,
  tone = 'default',
  onClick,
  onRemove,
  disabled,
  className,
  ariaLabel,
}: ChipProps) {
  const interactive = Boolean(onClick) && !disabled
  const t = toneStyles[tone]
  const Comp = interactive ? 'button' : 'span'
  return (
    <Comp
      type={interactive ? 'button' : undefined}
      onClick={interactive ? onClick : undefined}
      disabled={disabled || undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-sm transition',
        interactive && 'active:scale-[0.97]',
        selected ? t.selected : t.base,
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="删除标签"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="-mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Comp>
  )
}
