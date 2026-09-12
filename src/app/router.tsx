import { createBrowserRouter } from 'react-router-dom'
import type { Router } from '@remix-run/router'
import { AppShell } from './AppShell'
import { RouteError } from './RouteError'

/**
 * 路由表（分工 §2.4 规则 4：由 Agent-0 维护）。
 * 各业务 Agent 以「路由片段」形式提交 `{ path, lazy() }`，Agent-0 合并进本文件；
 * 页面全部 lazy 加载（TDD §2.3 v6 data router + T5-01 分包）。
 * 4 个 Tab 走 AppShell 布局；capture/scan/restaurant/dish 为全屏页面（无底部导航）。
 */
function createAppRouter(): Router {
  return createBrowserRouter([
    {
      element: <AppShell />,
      errorElement: <RouteError />,
      children: [
        // T1-09：Agent-3 自助合入（片段见 src/pages/home/route.ts），待 Agent-0 复核
        { path: '/', lazy: () => import('@/pages/home/HomePage') },
        // T1-10/T4-02：Agent-5 自助合入（片段见 src/pages/{dex,insights}/route.ts），待 Agent-0 复核
        { path: '/dex', lazy: () => import('@/pages/dex/DexPage') },
        { path: '/insights', lazy: () => import('@/pages/insights/InsightsPage') },
        { path: '/settings', lazy: () => import('./placeholders/settings') },
      ],
    },
    {
      errorElement: <RouteError />,
      children: [
        // T2-03~08：Agent-3 自助合入（片段见 src/pages/capture/route.ts），待 Agent-0 复核
        { path: '/capture', lazy: () => import('@/pages/capture/CapturePage') },
        { path: '/scan/:rid?', lazy: () => import('./placeholders/scan') },
        // T1-11/T3-07：Agent-5 自助合入（片段见 src/pages/{restaurant,dish}/route.ts），待 Agent-0 复核
        { path: '/restaurant/:rid', lazy: () => import('@/pages/restaurant/RestaurantPage') },
        { path: '/dish/:id', lazy: () => import('@/pages/dish/DishPage') },
      ],
    },
  ])
}

/** 应用路由单例 */
export const router: ReturnType<typeof createAppRouter> = createAppRouter()
