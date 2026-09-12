/**
 * 三套模板共用节点树（PRD §8.2/§8.3 版式）：三模板仅调色板/字体/字号差异（§8.4）。
 * 版式自上而下：编号+稀有度头行 → 图片区(grow) → 星级 → 标题 → 副标题 → 标签
 * → 分隔线 → 成就文案 → 日期地点/水印行。缺失字段经 when 整块隐藏并重排（EC-CARD-02）。
 */
import type { CardNode } from '../types'

export function standardNodes(): CardNode[] {
  return [
    {
      kind: 'stack',
      direction: 'row',
      justify: 'space-between',
      id: 'header',
      gapAfter: 20,
      nodes: [
        {
          kind: 'text',
          field: 'unlockNo',
          when: { field: 'unlockNo', op: 'exists' },
          style: {
            family: 'body',
            size: 26,
            weight: 700,
            lineHeight: 36,
            color: 'gold',
            letterSpacing: 2,
          },
          maxLines: 1,
          id: 'unlock-no',
        },
        {
          kind: 'badge',
          chipHeight: 36,
          padX: 14,
          style: { family: 'body', size: 20, weight: 700, lineHeight: 36, color: 'onAccent' },
          id: 'rarity-badge',
        },
      ],
    },
    { kind: 'image', grow: true, radius: 20, placeholderHue: 150, gapAfter: 20, id: 'hero' },
    {
      kind: 'stars',
      starSize: 32,
      showValue: true,
      when: { field: 'rating', op: 'exists' },
      gapAfter: 12,
      id: 'stars',
    },
    {
      kind: 'text',
      field: 'title',
      style: { family: 'title', size: 44, weight: 900, lineHeight: 56, color: 'ink' },
      maxLines: 1,
      gapAfter: 8,
      id: 'title',
    },
    {
      kind: 'text',
      field: 'subtitle',
      when: { field: 'restaurantName', op: 'exists' },
      style: { family: 'body', size: 24, weight: 400, lineHeight: 32, color: 'inkMuted' },
      maxLines: 1,
      gapAfter: 14,
      id: 'subtitle',
    },
    {
      kind: 'chips',
      when: { field: 'tags', op: 'exists' },
      max: 5,
      chipHeight: 36,
      padX: 16,
      gap: 10,
      rowGap: 10,
      style: { family: 'body', size: 20, weight: 500, lineHeight: 20, color: 'ink' },
      bg: 'accentSoft',
      gapAfter: 18,
      id: 'tags',
    },
    {
      kind: 'divider',
      when: { field: 'achievement', op: 'exists' },
      thickness: 1,
      color: 'line',
      gapAfter: 16,
      id: 'divider',
    },
    {
      kind: 'text',
      field: 'achievement',
      when: { field: 'achievement', op: 'exists' },
      style: { family: 'body', size: 24, weight: 500, lineHeight: 36, color: 'accent' },
      maxLines: 2,
      gapAfter: 14,
      id: 'achievement',
    },
    {
      kind: 'stack',
      direction: 'row',
      justify: 'space-between',
      id: 'meta-row',
      nodes: [
        {
          kind: 'text',
          field: 'meta',
          when: { field: 'ateAt', op: 'exists' },
          style: { family: 'body', size: 20, weight: 400, lineHeight: 26, color: 'inkMuted' },
          maxLines: 1,
          id: 'meta',
        },
        {
          kind: 'text',
          field: 'watermark',
          when: { field: 'watermark', op: 'exists' },
          style: { family: 'body', size: 20, weight: 400, lineHeight: 26, color: 'inkMuted' },
          maxLines: 1,
          id: 'watermark',
        },
      ],
    },
  ]
}
