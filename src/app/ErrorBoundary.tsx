import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/ui'
import { APP_VERSION } from './version'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 全局 ErrorBoundary（T0-07 验收：报错不白屏）。
 * 路由级错误由 router 的 errorElement（RouteError）兜底，本组件兜底渲染期错误。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 本地埋点队列（TDD §2.4 infra/analytics）就绪后接入；默认不外发
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-avoid" aria-hidden />
        <h1 className="text-lg font-semibold">页面出错了</h1>
        <p className="max-w-sm text-sm text-ink-muted">
          你的数据保存在本地，不会丢失。可尝试重新加载页面。
        </p>
        <p className="max-w-sm break-all text-xs text-ink-muted/70">
          {error.message} · v{APP_VERSION}
        </p>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    )
  }
}
