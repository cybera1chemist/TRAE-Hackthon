/**
 * 布局引擎（T5-01 核心）：模板节点树 + CardData → DrawOp[]。
 * 纯函数、无 Canvas 依赖（measure/图片由环境注入），便于快照单测（TDD §3.7）。
 * - 条件显隐：when 不满足 → 整块移除；
 * - 空间重排：grow 节点（图片区）吸收剩余空间，无 grow 时富余均摊到节点间距（EC-CARD-01/02）；
 * - 文本：fitLine/fitBlock 截断（EC-CARD-03）。
 */
import { rarityOf, starFractions, RARITY_LABEL } from './rarity'
import { fitBlock, fitLine, type MeasureText } from './text'
import {
  CARD_BOTTOM_SAFE,
  CARD_H,
  CARD_SAFE,
  CARD_W,
  CONTENT_W,
  type CardData,
  type CardNode,
  type CardTemplate,
  type ChipsNode,
  type DrawOp,
  type LoadedImage,
  type StackNode,
  type StarsNode,
  type TemplatePalette,
  type TextNode,
  type TextStyle,
  type WhenCondition,
} from './types'

export interface OpsEnv {
  measure: MeasureText
  image: LoadedImage | null
}

type ColorToken = TextStyle['color']

function paletteColor(p: TemplatePalette, token: ColorToken): string {
  return p[token]
}

function fontString(style: TextStyle, fonts: CardTemplate['fonts']): string {
  const family = style.family === 'title' ? fonts.title : fonts.body
  return `${style.weight} ${style.size}px ${family}`
}

function evalWhen(when: WhenCondition | undefined, data: CardData): boolean {
  if (!when) return true
  const v = data[when.field]
  switch (when.op) {
    case 'exists':
      return v !== undefined && v !== null && v !== ''
    case 'truthy':
      return Boolean(v)
    case 'eq':
      return v === when.value
    case 'gte':
      return typeof v === 'number' && v >= (when.value as number)
    case 'lte':
      return typeof v === 'number' && v <= (when.value as number)
  }
}

function visibleNodes(nodes: CardNode[], data: CardData): CardNode[] {
  return nodes.filter((n) => evalWhen(n.when, data))
}

/** 文本字段视图解析（组合/格式化） */
function resolveText(field: TextNode['field'], data: CardData): string {
  switch (field) {
    case 'title':
      return data.dishName
    case 'subtitle':
      return [data.restaurantName, data.cuisine].filter(Boolean).join(' · ')
    case 'unlockNo':
      return data.unlockNo === undefined ? '' : `No.${String(data.unlockNo).padStart(3, '0')}`
    case 'rarity': {
      const r = rarityOf(data)
      return r ? RARITY_LABEL[r] : ''
    }
    case 'comment':
      return data.comment ?? ''
    case 'achievement':
      return data.achievement ?? ''
    case 'meta': {
      const date = data.ateAt ? new Date(data.ateAt) : null
      const ymd =
        date && !Number.isNaN(date.getTime())
          ? `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
          : ''
      return [ymd, data.place].filter(Boolean).join(' · ')
    }
    case 'watermark':
      return data.watermark ?? ''
  }
}

/** 单行文本自然宽度（含截断上限），供行内布局测量 */
function naturalLine(
  text: string,
  style: TextStyle,
  maxWidth: number,
  env: OpsEnv,
): { text: string; width: number } {
  const fitted = fitLine(text, style, maxWidth, env.measure)
  return { text: fitted.text, width: Math.min(env.measure(fitted.text, style), maxWidth) }
}

function chipsLayout(
  node: ChipsNode,
  data: CardData,
  env: OpsEnv,
): {
  chips: { text: string; x: number; y: number; w: number; h: number }[]
  rows: number
  w: number
} {
  const tags = (data.tags ?? []).slice(0, node.max)
  const chips: { text: string; x: number; y: number; w: number; h: number }[] = []
  let x = 0
  let y = 0
  let rows = 0
  for (const tag of tags) {
    const textW = env.measure(tag, node.style)
    const w = textW + node.padX * 2
    if (x > 0 && x + w > CONTENT_W) {
      x = 0
      y += node.chipHeight + node.rowGap
    }
    chips.push({ text: tag, x, y, w, h: node.chipHeight })
    x += w + node.gap
  }
  rows = chips.length === 0 ? 0 : y / (node.chipHeight + node.rowGap) + 1
  return { chips, rows, w: CONTENT_W }
}

/** 固定高度测量（grow 节点按 0 计），用于计算 grow 吸收量 */
function fixedHeight(
  node: CardNode,
  data: CardData,
  fonts: CardTemplate['fonts'],
  env: OpsEnv,
): number {
  if (evalWhen(node.when, data) === false) return 0
  switch (node.kind) {
    case 'stack':
      if (node.direction === 'row') {
        const heights = visibleNodes(node.nodes, data).map(
          (c) => fixedHeight(c, data, fonts, env) || nodeMaxRowHeight(c, data, fonts, env),
        )
        return heights.length ? Math.max(...heights) : 0
      }
      return stackColumnHeight(node, data, fonts, env)
    case 'text': {
      const text = resolveText(node.field, data)
      if (!text) return 0
      const { lines } =
        node.maxLines === 1
          ? { lines: [fitLine(text, node.style, CONTENT_W, env.measure).text] }
          : fitBlock(text, node.style, CONTENT_W, node.maxLines, env.measure)
      return lines.length * node.style.lineHeight
    }
    case 'stars':
      return node.starSize
    case 'chips':
      return chipsLayout(node, data, env).rows * (node.chipHeight + node.rowGap) - node.rowGap
    case 'badge':
      return node.chipHeight
    case 'divider':
      return node.thickness
    case 'image':
      return 0 // grow
  }
}

function nodeMaxRowHeight(
  node: CardNode,
  data: CardData,
  fonts: CardTemplate['fonts'],
  env: OpsEnv,
): number {
  switch (node.kind) {
    case 'text':
      return node.style.lineHeight
    case 'stars':
      return node.starSize
    case 'badge':
      return node.chipHeight
    default:
      return fixedHeight(node, data, fonts, env)
  }
}

function stackColumnHeight(
  node: StackNode,
  data: CardData,
  fonts: CardTemplate['fonts'],
  env: OpsEnv,
): number {
  const vis = visibleNodes(node.nodes, data)
  let h = 0
  for (const child of vis) {
    h += fixedHeight(child, data, fonts, env)
    h += child.gapAfter ?? node.gap ?? 0
  }
  return vis.length ? h - (vis[vis.length - 1].gapAfter ?? node.gap ?? 0) : 0
}

/**
 * 产出绘制指令。
 * 根布局：内容区固定列（安全区内），可用高 = 卡高 - 上安全区 - 底部避让区。
 */
export function buildOps(template: CardTemplate, data: CardData, env: OpsEnv): DrawOp[] {
  const ops: DrawOp[] = [
    { op: 'rect', x: 0, y: 0, w: CARD_W, h: CARD_H, r: 0, fill: template.palette.bg },
  ]

  // 避雷皮肤顶部警示条（黄黑斜纹，PRD §8.4）
  if (template.stripeBarHeight) {
    ops.push({
      op: 'stripes',
      x: 0,
      y: 0,
      w: CARD_W,
      h: template.stripeBarHeight,
      colors: template.palette.stripe,
    })
  }

  const top = CARD_SAFE + (template.stripeBarHeight ?? 0)
  const availableH = CARD_H - top - CARD_BOTTOM_SAFE
  const nodes = visibleNodes(template.nodes, data)

  const fixedSum = nodes.reduce((sum, n) => {
    const gap = n.gapAfter ?? 0
    return sum + fixedHeight(n, data, template.fonts, env) + gap
  }, 0)
  const growNode = nodes.find((n) => n.grow)
  const leftover = Math.max(0, availableH - (fixedSum - lastGap(nodes)))
  const extraGap = growNode ? 0 : nodes.length > 1 ? leftover / (nodes.length - 1) : 0
  const growH = growNode ? leftover : 0

  let y = top
  let emitted = 0
  for (const node of nodes) {
    if (emitted > 0) y += extraGap
    y += emitNode(ops, node, data, template, env, CARD_SAFE, y, CONTENT_W, node.grow ? growH : 0)
    y += node.gapAfter ?? 0
    emitted += 1
  }
  return ops
}

function lastGap(nodes: CardNode[]): number {
  return nodes.length ? (nodes[nodes.length - 1].gapAfter ?? 0) : 0
}

/** 绘制单节点并把游标推进节点高度 */
function emitNode(
  ops: DrawOp[],
  node: CardNode,
  data: CardData,
  template: CardTemplate,
  env: OpsEnv,
  x: number,
  y: number,
  w: number,
  growH: number,
): number {
  const p = template.palette
  switch (node.kind) {
    case 'image': {
      const h = growH
      if (h <= 0) return 0
      if (env.image) {
        ops.push({ op: 'image', x, y, w, h, r: node.radius, img: env.image })
      } else {
        // 无图：菜系色矢量占位（EC-CARD-01）
        ops.push({ op: 'placeholder', x, y, w, h, r: node.radius, hue: node.placeholderHue })
      }
      return h
    }
    case 'text': {
      const text = resolveText(node.field, data)
      if (!text) return 0
      const font = fontString(node.style, template.fonts)
      const color = paletteColor(p, node.style.color)
      if (node.maxLines === 1) {
        const fitted = fitLine(text, node.style, w, env.measure)
        ops.push({
          op: 'text',
          x,
          y,
          w,
          lines: [fitted.text],
          font,
          color,
          lineHeight: node.style.lineHeight,
          letterSpacing: node.style.letterSpacing ?? 0,
          align: 'left',
        })
        return node.style.lineHeight
      }
      const block = fitBlock(text, node.style, w, node.maxLines, env.measure)
      ops.push({
        op: 'text',
        x,
        y,
        w,
        lines: block.lines,
        font,
        color,
        lineHeight: node.style.lineHeight,
        letterSpacing: node.style.letterSpacing ?? 0,
        align: 'left',
      })
      return block.lines.length * node.style.lineHeight
    }
    case 'stars': {
      if (data.rating === null) return 0
      emitStars(ops, node, data, template, x, y, w)
      return node.starSize
    }
    case 'chips': {
      const layout = chipsLayout(node, data, env)
      if (layout.chips.length === 0) return 0
      ops.push({
        op: 'chips',
        chips: layout.chips.map((c) => ({ ...c, x: x + c.x, y: y + c.y })),
        bg: node.bg === 'accentSoft' ? p.accentSoft : p.line,
        font: fontString(node.style, template.fonts),
        color: p.ink,
      })
      return layout.rows * (node.chipHeight + node.rowGap) - node.rowGap
    }
    case 'badge': {
      const text = resolveText('rarity', data)
      if (!text) return 0
      const isWarning = rarityOf(data) === 'warning'
      const textW = env.measure(text, node.style)
      const bw = textW + node.padX * 2
      // 角标靠右（PRD §8.2：位于图左上→置于头部行右侧；warning 用黄黑斜纹底）
      if (isWarning) {
        ops.push({ op: 'stripes', x: x + w - bw, y, w: bw, h: node.chipHeight, colors: p.stripe })
        ops.push({
          op: 'text',
          x: x + w - bw + node.padX,
          y,
          w: textW,
          lines: [text],
          font: fontString(node.style, template.fonts),
          color: '#1A1A1A',
          lineHeight: node.chipHeight,
          letterSpacing: 0,
          align: 'left',
        })
      } else {
        ops.push({
          op: 'rect',
          x: x + w - bw,
          y,
          w: bw,
          h: node.chipHeight,
          r: node.chipHeight / 2,
          fill: p.accent,
        })
        ops.push({
          op: 'text',
          x: x + w - bw + node.padX,
          y,
          w: textW,
          lines: [text],
          font: fontString(node.style, template.fonts),
          color: p.onAccent,
          lineHeight: node.chipHeight,
          letterSpacing: 0,
          align: 'left',
        })
      }
      return node.chipHeight
    }
    case 'divider': {
      ops.push({
        op: 'rect',
        x,
        y,
        w,
        h: node.thickness,
        r: 0,
        fill: node.color === 'accent' ? p.accent : p.line,
      })
      return node.thickness
    }
    case 'stack': {
      return node.direction === 'row'
        ? emitRow(ops, node, data, template, env, x, y, w)
        : emitColumn(ops, node, data, template, env, x, y, w)
    }
  }
}

function emitColumn(
  ops: DrawOp[],
  node: StackNode,
  data: CardData,
  template: CardTemplate,
  env: OpsEnv,
  x: number,
  y: number,
  w: number,
): number {
  const children = visibleNodes(node.nodes, data)
  let cy = y
  for (const child of children) {
    cy += emitNode(
      ops,
      child,
      data,
      template,
      env,
      x,
      cy,
      w,
      fixedHeight(child, data, template.fonts, env),
    )
    cy += child.gapAfter ?? node.gap ?? 0
  }
  return children.length ? cy - y - (children[children.length - 1].gapAfter ?? node.gap ?? 0) : 0
}

function emitRow(
  ops: DrawOp[],
  node: StackNode,
  data: CardData,
  template: CardTemplate,
  env: OpsEnv,
  x: number,
  y: number,
  w: number,
): number {
  const children = visibleNodes(node.nodes, data)
  const gap = node.gap ?? 0
  // 先测自然宽度（单行文本），grow 子节点吃剩余宽
  const widths = children.map((c) => {
    if (c.grow) return 0
    if (c.kind === 'text') {
      const t = resolveText(c.field, data)
      return t ? naturalLine(t, c.style, w / 2, env).width : 0
    }
    if (c.kind === 'badge') {
      const t = resolveText('rarity', data)
      return t ? env.measure(t, c.style) + c.padX * 2 : 0
    }
    return 0
  })
  const naturalSum = widths.reduce((a, b) => a + b, 0) + gap * (children.length - 1)
  const restW = Math.max(0, w - naturalSum)

  let cx = x
  const spaceBetween = node.justify === 'space-between' && children.length > 1
  const slots: number[] = []
  children.forEach((c, i) => {
    slots.push(c.grow ? restW : widths[i])
  })
  const total = slots.reduce((a, b) => a + b, 0) + gap * (children.length - 1)
  const justifyGap = spaceBetween ? (w - total) / (children.length - 1) : 0

  children.forEach((child, i) => {
    const childW = slots[i]
    if (childW > 0) {
      emitNode(ops, child, data, template, env, cx, y, childW, 0)
    }
    cx += childW + gap + justifyGap
  })
  return Math.max(...children.map((c) => nodeMaxRowHeight(c, data, template.fonts, env)), 0)
}

function emitStars(
  ops: DrawOp[],
  node: StarsNode,
  data: CardData,
  template: CardTemplate,
  x: number,
  y: number,
  w: number,
): void {
  const rating = data.rating as number
  const fractions = starFractions(rating)
  ops.push({
    op: 'stars',
    x,
    y,
    size: node.starSize,
    fractions,
    colorOn: template.palette.gold,
    colorOff: template.palette.line,
    valueText: node.showValue ? rating.toFixed(1) : '',
    valueFont: `600 ${Math.round(node.starSize * 0.52)}px ${template.fonts.body}`,
    valueColor: template.palette.ink,
  })
  void w
}
