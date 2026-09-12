import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from './cn'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

/** 开关（避雷手标、AI 辅助命名等布尔设置） */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, disabled, className },
  ref,
) {
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-line transition',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-2',
        disabled && 'opacity-50',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6" />
    </SwitchPrimitive.Root>
  )

  if (!label) return control

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink">{label}</span>
      {control}
    </label>
  )
})
