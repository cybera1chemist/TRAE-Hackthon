import type { ReactNode } from 'react'
import { PackageOpen } from 'lucide-react'
import { cn } from './cn'

export interface EmptyProps {
  /** lucide 图标组件或自定义插画 */
  icon?: ReactNode
  title: string
  description?: string
  /** 主行动按钮（如“去打卡”“扫描菜单”） */
  action?: ReactNode
  className?: string
}

/** 空状态（图鉴无店铺、搜索无结果、时间线为空等） */
export function Empty({ icon, title, description, action, className }: EmptyProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
        {icon ?? <PackageOpen className="h-7 w-7" aria-hidden />}
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
