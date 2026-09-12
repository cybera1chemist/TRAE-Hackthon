import type { RouteObject } from 'react-router-dom'

/**
 * 路由片段（分工 §2.4 规则 4）：由 Agent-0 合并进 src/app/router.tsx，
 * 替换现有 /dex 的 placeholder。
 */
export const dexRouteFragment: RouteObject = {
  path: '/dex',
  lazy: () => import('./DexPage'),
}
