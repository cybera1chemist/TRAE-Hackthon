import type { Config } from 'tailwindcss'

/**
 * 主题色板：TDD §2.3（Tailwind + CSS Variables）。
 * 颜色以「空格分隔的 RGB 三元组」存放在 CSS 变量中（src/styles/theme.css），
 * 便于 <alpha-value> 控制透明度；暗色模式通过 <html class="dark"> 切换。
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--c-ink-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)',
          fg: 'rgb(var(--c-primary-fg) / <alpha-value>)',
        },
        gold: 'rgb(var(--c-gold) / <alpha-value>)',
        avoid: 'rgb(var(--c-avoid) / <alpha-value>)',
        locked: 'rgb(var(--c-locked) / <alpha-value>)',
        neon: {
          red: 'rgb(var(--c-neon-red) / <alpha-value>)',
          cyan: 'rgb(var(--c-neon-cyan) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'PingFang SC',
          'HarmonyOS Sans SC',
          'MiSans',
          'Microsoft YaHei',
          'Noto Sans SC',
          'sans-serif',
        ],
        // 图鉴/出片标题字体：可在 public/fonts 放置子集化可商用字体后启用
        display: ['var(--font-display)'],
      },
      borderRadius: {
        card: '1rem',
      },
      boxShadow: {
        card: '0 2px 8px rgb(0 0 0 / 0.08)',
        raised: '0 8px 24px rgb(0 0 0 / 0.16)',
      },
      zIndex: {
        nav: '40',
        toast: '60',
      },
    },
  },
  plugins: [],
} satisfies Config
