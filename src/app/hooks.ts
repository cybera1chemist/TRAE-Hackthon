import { useCallback, useState } from 'react'
import { applyTheme, getStoredTheme, type Theme } from './theme'

/** 主题 Hook：供设置页等切换暗色模式（T0-05 主题自测入口） */
export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)

  const set = useCallback((t: Theme) => {
    applyTheme(t)
    setTheme(t)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  return { theme, toggle, set }
}
