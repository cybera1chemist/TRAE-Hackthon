/** 模板 B · 霓虹夜市（PRD §8.4）：深紫黑 + 霓虹红/青，适用烧烤/火锅/夜宵/辣菜 */
import type { CardTemplate } from '../types'
import { standardNodes } from './shared'

export const neonTemplate: CardTemplate = {
  id: 'neon',
  name: '霓虹夜市',
  palette: {
    bg: '#12101C',
    surface: '#1A1625',
    ink: '#EDE9F4',
    inkMuted: '#948EA5',
    accent: '#22D3EE',
    gold: '#D4AF55',
    onAccent: '#12101C',
    accentSoft: '#1F2A33',
    line: '#372F4A',
    stripe: ['#FFD400', '#1A1A1A'],
  },
  fonts: {
    title: '"FoodDex Display", "Noto Serif SC", "Songti SC", Georgia, serif',
    body: '"FoodDex Body", system-ui, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  nodes: standardNodes(),
}
