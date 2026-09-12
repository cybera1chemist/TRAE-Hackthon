import { NavLink, Outlet } from 'react-router-dom'
import { Home, Library, PieChart, UserRound, type LucideIcon } from 'lucide-react'
import { cn } from '@/ui'

/**
 * 底部导航 4 Tab（T0-07 / PRD §4 IA）：首页 / 图鉴 / 洞察 / 我的。
 * 触控目标 ≥ 44px；各业务页面的路由片段由各 Agent 提交、Agent-0 合并（分工 §2.4）。
 */
const TABS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/dex', label: '图鉴', icon: Library },
  { to: '/insights', label: '洞察', icon: PieChart },
  { to: '/settings', label: '我的', icon: UserRound },
]

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <main className="pb-[calc(64px+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-nav flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-surface/80"
      >
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-xs transition',
                isActive ? 'font-medium text-primary' : 'text-ink-muted hover:text-ink',
              )
            }
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
