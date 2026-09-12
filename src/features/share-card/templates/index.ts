/**
 * 模板注册与避雷皮肤（T5-03）：1–2 星或 isAvoid → 「雷品警报」黄黑皮肤（PRD §8.4）。
 * 模板横滑选择由出片交互层（T5-04）调用 getTemplate；皮肤在选中的模板上叠加。
 */
import type { CardData, CardTemplate, TemplatePalette } from '../types'
import { classicTemplate } from './classic'
import { michelinTemplate } from './michelin'
import { neonTemplate } from './neon'

export const TEMPLATES: CardTemplate[] = [classicTemplate, neonTemplate, michelinTemplate]

export function getTemplate(id: CardTemplate['id']): CardTemplate {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`unknown card template: ${id}`)
  return t
}

const WARNING_PALETTE: TemplatePalette = {
  bg: '#2B2B2B',
  surface: '#3A3A3A',
  ink: '#F5F5F5',
  inkMuted: '#B5B5B5',
  accent: '#FFD400',
  gold: '#FFD400',
  onAccent: '#1A1A1A',
  accentSoft: '#3A3A3A',
  line: '#4A4A4A',
  stripe: ['#FFD400', '#1A1A1A'],
}

/** 雷品警报皮肤：暗灰底 + 顶部黄黑警示条（自嘲式分享，默认关闭外部分享二次确认由 UI 层负责） */
export function withWarningSkin(template: CardTemplate): CardTemplate {
  return {
    ...template,
    id: 'warning',
    name: '雷品警报',
    palette: WARNING_PALETTE,
    stripeBarHeight: 12,
  }
}

/** 依据数据自动套皮：避雷（isAvoid 或评分 ≤2）→ 黄黑皮肤，其余保持所选模板 */
export function applySkin(
  template: CardTemplate,
  data: Pick<CardData, 'rating' | 'isAvoid'>,
): CardTemplate {
  const avoid = data.isAvoid || (data.rating !== null && data.rating <= 2)
  return avoid ? withWarningSkin(template) : template
}

export { classicTemplate, neonTemplate, michelinTemplate }
