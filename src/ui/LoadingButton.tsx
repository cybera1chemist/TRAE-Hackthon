import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from './Button'
import { cn } from './cn'

export interface LoadingButtonProps extends ButtonProps {
  /** 为 true 时禁用并显示 spinner，保留宽度避免布局抖动 */
  loading?: boolean
}

/** 异步提交按钮（识别中/保存中等场景） */
export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  function LoadingButton({ loading = false, disabled, className, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        aria-busy={loading}
        disabled={disabled || loading}
        className={cn(className)}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </Button>
    )
  },
)
