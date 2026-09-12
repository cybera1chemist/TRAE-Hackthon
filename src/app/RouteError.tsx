import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/ui'

/** 路由级错误兜底（data router errorElement）：报错不白屏（T0-07 验收） */
export function RouteError() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '未知错误'

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-avoid" aria-hidden />
      <h1 className="text-lg font-semibold">页面加载失败</h1>
      <p className="max-w-sm break-all text-sm text-ink-muted">{message}</p>
      <Button onClick={() => window.location.reload()}>重新加载</Button>
    </div>
  )
}
