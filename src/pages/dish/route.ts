import type { RouteObject } from 'react-router-dom'

/**
 * 路由片段（分工 §2.4 规则 4）：由 Agent-0 合并进 src/app/router.tsx，
 * 替换现有 /dish/:id 的 placeholder（全屏页，无底部导航）。
 */
export const dishRouteFragment: RouteObject = {
  path: '/dish/:id',
  lazy: () => import('./DishPage'),
}
