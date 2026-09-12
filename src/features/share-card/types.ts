/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 出片引擎类型（T5-01，Agent-6 独占目录）。
 * 依据：TDD §3.7（模板即数据 / @2x 离屏 / 纯函数绘制）、PRD §8（版式与适配规则）。
 * 输入数据 CardData 由调用方（Agent-3 打卡成功页 / Agent-5 菜品详情页）组装，
 * 引擎只消费本文件类型，不 import 任何页面/仓储实现。
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** 设计画幅：逻辑 540×720，@2x 导出 1080×1440（PRD §8.1 3:4 竖版） */
export const CARD_W = 540
export const CARD_H = 720
export const CARD_SCALE = 2
/** 安全区：四周 ≥64px（物理），底部避开 120px 平台遮挡区（物理） */
export const CARD_SAFE = 32
export const CARD_BOTTOM_SAFE = 60
export const CONTENT_W = CARD_W - CARD_SAFE * 2

/** 渲染失败归一化错误码（EC-CARD-04/05 对应 TAINTED / FONT_*） */
export type CardErrorCode = 'FONT_TIMEOUT' | 'IMAGE_DECODE' | 'CARD_TAINTED' | 'EXPORT_FAILED'

export class CardRenderError extends Error {
  readonly code: CardErrorCode
  constructor(code: CardErrorCode, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'CardRenderError'
    this.code = code
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

/**
 * 出片输入快照：由调用方从实体（Dish/Log/Restaurant/Photo）组装。
 * 全部字段可缺省（除菜名），缺失字段对应模块整块隐藏并重排（PRD §8.5 / EC-CARD-02）。
 */
export interface CardData {
  dishName: string
  restaurantName?: string
  cuisine?: string
  /** 0.5–5，null=未评分（星级块隐藏） */
  rating: number | null
  isAvoid: boolean
  /** 解锁编号（第 N 个解锁 → No.061），由调用方查询后传入 */
  unlockNo?: number
  /** 置信度最高的口味/场景标签，3–5 枚 */
  tags?: string[]
  /** 用户感想（≤2 行 40 字，超出省略，EC-CARD-03） */
  comment?: string
  /** 游戏化成就一句话（如「🔥 新图鉴解锁！…」），由调用方生成 */
  achievement?: string
  ateAt?: string
  place?: string
  /** 本地图片 Blob（一律 objectURL 同源加载，EC-CARD-04）；无图走菜系色占位 */
  photo?: Blob | null
  /** 个人水印（设置页开关控制），如「@广州食客」 */
  watermark?: string
}

/* ── 模板节点树（模板即数据，TDD §3.7） ─────────────────────────────────── */

/** 条件显隐：对 CardData 原始字段求值，不满足则整块移除并重排 */
export interface WhenCondition {
  field: keyof CardData
  op: 'exists' | 'truthy' | 'eq' | 'gte' | 'lte'
  value?: unknown
}

/** 文本字段视图：从 CardData 派生（组合/格式化），在 ops 层解析 */
export type TextField =
  | 'title' // 菜名（1 行 12 字省略）
  | 'subtitle' // 店铺名 · 菜系（1 行 14 字）
  | 'unlockNo' // No.061
  | 'rarity' // 稀有度角标文案（COMMON/RARE/…）
  | 'comment' // 感想（≤2 行）
  | 'achievement' // 成就文案（≤2 行）
  | 'meta' // 日期 · 地点
  | 'watermark' // 水印

export interface TextStyle {
  /** 字体族：模板 fonts 的 key */
  family: 'title' | 'body'
  size: number
  weight: 400 | 500 | 600 | 700 | 900
  /** 行高（设计像素） */
  lineHeight: number
  /** 调色板颜色 token */
  color: 'ink' | 'inkMuted' | 'accent' | 'gold' | 'onAccent'
  letterSpacing?: number
  maxChars?: number
}

interface NodeBase {
  id: string
  when?: WhenCondition
  /** 与下方兄弟节点的间距（设计像素） */
  gapAfter?: number
  /** 垂直堆叠中吸收剩余空间（图片区用） */
  grow?: boolean
}

export interface StackNode extends NodeBase {
  kind: 'stack'
  direction: 'row' | 'column'
  gap?: number
  /** row 专用：两端对齐（meta 行） */
  justify?: 'start' | 'space-between'
  nodes: CardNode[]
}
export interface ImageNode extends NodeBase {
  kind: 'image'
  radius: number
  /** 无图占位的菜系色相（PRD §8.5 菜系色矢量插画占位） */
  placeholderHue: number
}
export interface TextNode extends NodeBase {
  kind: 'text'
  field: TextField
  style: TextStyle
  maxLines: 1 | 2
}
export interface StarsNode extends NodeBase {
  kind: 'stars'
  starSize: number
  showValue: boolean
}
export interface ChipsNode extends NodeBase {
  kind: 'chips'
  max: number
  chipHeight: number
  padX: number
  gap: number
  rowGap: number
  style: TextStyle
  bg: 'accentSoft' | 'line'
}
export interface BadgeNode extends NodeBase {
  kind: 'badge'
  chipHeight: number
  padX: number
  style: TextStyle
}
export interface DividerNode extends NodeBase {
  kind: 'divider'
  thickness: number
  color: 'line' | 'accent'
}

export type CardNode =
  StackNode | ImageNode | TextNode | StarsNode | ChipsNode | BadgeNode | DividerNode

/** 调色板（模板自带，独立于应用主题；避雷皮肤经 withWarningSkin 替换） */
export interface TemplatePalette {
  bg: string
  surface: string
  ink: string
  inkMuted: string
  accent: string
  gold: string
  onAccent: string
  accentSoft: string
  line: string
  /** 避雷斜纹双色（黄黑，PRD §8.4 雷品警报） */
  stripe: [string, string]
}

export interface CardTemplate {
  id: 'classic' | 'neon' | 'michelin' | 'warning'
  name: string
  palette: TemplatePalette
  fonts: { title: string; body: string }
  /** 避雷皮肤顶部黄黑警示条高度（设计像素），缺省无 */
  stripeBarHeight?: number
  nodes: CardNode[]
}

/* ── 绘制指令（纯函数产出，render 层执行；便于快照单测） ────────────────── */

export interface LoadedImage {
  source: CanvasImageSource
  width: number
  height: number
}

export type DrawOp =
  | { op: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { op: 'stripes'; x: number; y: number; w: number; h: number; colors: [string, string] }
  | {
      op: 'text'
      x: number
      y: number
      w: number
      lines: string[]
      font: string
      color: string
      lineHeight: number
      letterSpacing: number
      align: 'left' | 'right'
    }
  | {
      op: 'stars'
      x: number
      y: number
      size: number
      fractions: [number, number, number, number, number]
      colorOn: string
      colorOff: string
      valueText: string
      valueFont: string
      valueColor: string
    }
  | {
      op: 'chips'
      chips: { text: string; x: number; y: number; w: number; h: number }[]
      bg: string
      font: string
      color: string
    }
  | { op: 'image'; x: number; y: number; w: number; h: number; r: number; img: LoadedImage }
  | { op: 'placeholder'; x: number; y: number; w: number; h: number; r: number; hue: number }
