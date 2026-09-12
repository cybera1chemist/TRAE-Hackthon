import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from './cn'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** 默认 3200ms */
  duration?: number
}

interface ToastItem {
  id: number
  title: string
  description?: string
  variant: ToastVariant
  duration: number
}

const ToastContext = createContext<(o: ToastOptions) => void>(() => {})

const variantIcon: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />,
  error: <AlertTriangle className="h-5 w-5 shrink-0 text-avoid" aria-hidden />,
  info: <Info className="h-5 w-5 shrink-0 text-gold" aria-hidden />,
}

/** 全局 Toast Provider（Radix Toast 封装）。视口固定在底部导航上方。 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const toast = useCallback((o: ToastOptions) => {
    const id = ++nextId.current
    setItems((prev) => [
      ...prev.slice(-2),
      {
        id,
        title: o.title,
        description: o.description,
        variant: o.variant ?? 'info',
        duration: o.duration ?? 3200,
      },
    ])
  }, [])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value = useMemo(() => toast, [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastPrimitive.Provider swipeDirection="down" label="通知">
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration}
            onOpenChange={(open) => {
              if (!open) remove(t.id)
            }}
            className={cn(
              'flex items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 shadow-raised',
              'data-[state=closed]:opacity-0 data-[state=open]:opacity-100 data-[swipe=end]:opacity-0',
            )}
          >
            {variantIcon[t.variant]}
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-sm font-medium text-ink">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="mt-0.5 text-xs text-ink-muted">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="关闭通知"
              className="text-ink-muted transition hover:text-ink"
            >
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-toast flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

/** 组件内调用：const toast = useToast(); toast({ title: '已保存', variant: 'success' }) */
export function useToast(): (o: ToastOptions) => void {
  return useContext(ToastContext)
}
