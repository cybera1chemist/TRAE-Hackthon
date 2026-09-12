import { forwardRef, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from './cn'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** bottom：移动端底部抽屉（默认）；right：桌面侧滑 */
  side?: 'bottom' | 'right'
  className?: string
}

/** 侧滑/底部抽屉（Radix Dialog 封装）：表单、筛选面板、菜单确认等场景 */
export const Sheet = forwardRef<HTMLDivElement, SheetProps>(function Sheet(
  { open, onOpenChange, title, description, children, footer, side = 'bottom', className },
  ref,
) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'fixed z-50 flex max-h-[85vh] flex-col border-line bg-surface shadow-raised focus:outline-none',
            side === 'bottom'
              ? 'inset-x-0 bottom-0 rounded-t-card border-t pb-[calc(16px+env(safe-area-inset-bottom))]'
              : 'right-0 top-0 h-full w-[85vw] max-w-sm border-l',
            className,
          )}
        >
          {/* 底部抽屉拖拽指示条 */}
          {side === 'bottom' && (
            <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />
          )}
          <div className="flex items-start justify-between px-5 pt-3">
            <div>
              {title && (
                <DialogPrimitive.Title className="text-lg font-semibold text-ink">
                  {title}
                </DialogPrimitive.Title>
              )}
              {description && (
                <DialogPrimitive.Description className="mt-1 text-sm text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})
