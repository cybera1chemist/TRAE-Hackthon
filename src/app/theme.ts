/** 主题工具：暗色模式 class 切换（index.html 内联脚本负责首帧无闪烁初值） */
export type Theme = 'light' | 'dark'

const THEME_KEY = 'fooddex.theme'

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}

/** main.tsx 启动时调用：与 index.html 内联脚本保持同一初值逻辑 */
export function initTheme(): void {
  applyTheme(getStoredTheme())
}
