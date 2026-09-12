/** 模板 A · 经典图鉴（PRD §8.4）：米白纸面 + 墨绿/烫金，宝可梦卡片式，默认全评分通用 */
import type { CardTemplate } from '../types'
import { standardNodes } from './shared'

export const classicTemplate: CardTemplate = {
  id: 'classic',
  name: '经典图鉴',
  palette: {
    bg: '#FAF7F0',
    surface: '#FFFFFF',
    ink: '#263229',
    inkMuted: '#7A867F',
    accent: '#2F5D50',
    gold: '#B08D38',
    onAccent: '#FAF7F0',
    accentSoft: '#E4EAE7',
    line: '#DFD8CA',
    stripe: ['#FFD400', '#1A1A1A'],
  },
  fonts: {
    title: '"FoodDex Display", "Noto Serif SC", "Songti SC", Georgia, serif',
    body: '"FoodDex Body", system-ui, "PingFang SC", "Noto Sans SC", sans-serif',
  },
  nodes: standardNodes(),
}
