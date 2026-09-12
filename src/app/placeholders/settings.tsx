import { useTheme } from '@/app/hooks'

/** 占位设置页：真实页面由 Agent-1（T5-05/06）交付；暗色开关用于 T0-05 主题自测 */
export function Component() {
  const { theme, toggle } = useTheme()
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6">
      <h1 className="mb-2 text-xl font-semibold font-display text-ink">我的</h1>
      <p className="mb-6 text-sm text-ink-muted">
        存储管理与导入导出由 Agent-1 交付（T5-05/06）；AI 服务配置由 Agent-2 交付（T5-03）。
      </p>
      <button
        type="button"
        onClick={toggle}
        className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm text-ink hover:bg-surface-2"
      >
        切换主题（当前：{theme === 'dark' ? '暗色' : '浅色'}）
      </button>
    </div>
  )
}
