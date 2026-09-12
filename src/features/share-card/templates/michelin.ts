/** 模板 C · 米其林留白（PRD §8.4）：大留白衬线排版 + 细线分隔，象牙白 + 黑金，适用高分正餐 */
import type { CardTemplate } from '../types'
import { standardNodes } from './shared'

export const michelinTemplate: CardTemplate = {
  id: 'michelin',
  name: '米其林留白',
  palette: {
    bg: '#FFFDF7',
    surface: '#FFFFFF',
    ink: '#1A1A1A',
    inkMuted: '#8A8A85',
    accent: '#1A1A1A',
    gold: '#B08D38',
    onAccent: '#FFFDF7',
    accentSoft: '#F2EEE4',
    line: '#E3DECF',
    stripe: ['#FFD400', '#1A1A1A'],
  },
  fonts: {
    title: '"FoodDex Display", "Noto Serif SC", "Songti SC", Georgia, serif',
    body: '"FoodDex Body", system-ui, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  nodes: standardNodes(),
}
