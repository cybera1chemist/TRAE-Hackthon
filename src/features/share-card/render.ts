/**
 * Canvas 渲染执行层（T5-01）：DrawOp[] → 离屏 Canvas → PNG/JPEG Blob。
 * - @2x 离屏绘制：设计画幅 540×720，导出 1080×1440（PRD §8.1）；
 * - 字体就绪后再绘制导出（EC-CARD-05，TDD §3.7）；
 * - 导出前 getImageData 污染探测（EC-CARD-04）；
 * - 对外契约：renderCard(data, template): Promise<Blob>（分工文档 §3 交付物表）。
 */
import { ensureCardFonts } from '../../infra/card/fonts'
import { buildOps } from './ops'
import {
  CARD_H,
  CARD_SCALE,
  CARD_W,
  CardRenderError,
  type CardData,
  type CardTemplate,
  type DrawOp,
  type LoadedImage,
} from './types'

export type RenderScale = 1 | 2

/** 圆角矩形路径（兼容未实现 ctx.roundRect 的浏览器） */
function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: [string, string],
): void {
  ctx.save()
  pathRoundRect(ctx, x, y, w, h, 0)
  ctx.clip()
  ctx.fillStyle = colors[0]
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = colors[1]
  const step = h
  for (let i = -h; i < w + h; i += step * 2) {
    ctx.beginPath()
    ctx.moveTo(x + i, y + h)
    ctx.lineTo(x + i + h, y)
    ctx.lineTo(x + i + h * 2, y)
    ctx.lineTo(x + i + h, y + h)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  fill: string,
): void {
  const inner = outer * 0.45
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const px = cx + rad * Math.cos(angle)
    const py = cy + rad * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

/** 执行绘制指令（指令集与执行分离：指令层纯函数可快照单测） */
export function executeOps(ctx: CanvasRenderingContext2D, ops: DrawOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'rect':
        pathRoundRect(ctx, op.x, op.y, op.w, op.h, op.r)
        ctx.fillStyle = op.fill
        ctx.fill()
        break
      case 'stripes':
        drawStripes(ctx, op.x, op.y, op.w, op.h, op.colors)
        break
      case 'text': {
        ctx.save()
        ctx.font = op.font
        ctx.fillStyle = op.color
        ctx.textBaseline = 'top'
        ctx.textAlign = op.align
        if ('letterSpacing' in ctx) {
          ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
            `${op.letterSpacing}px`
        }
        op.lines.forEach((line, i) => {
          ctx.fillText(line, op.x, op.y + i * op.lineHeight)
        })
        ctx.restore()
        break
      }
      case 'stars': {
        op.fractions.forEach((frac, i) => {
          const cx = op.x + op.size / 2 + i * op.size * 1.15
          const cy = op.y + op.size / 2
          if (frac > 0) {
            drawStar(ctx, cx, cy, op.size / 2, op.colorOff)
            if (frac > 0) {
              ctx.save()
              ctx.beginPath()
              const clipW = frac === 1 ? op.size : op.size / 2
              ctx.rect(cx - op.size / 2, cy - op.size / 2, clipW, op.size)
              ctx.clip()
              drawStar(ctx, cx, cy, op.size / 2, op.colorOn)
              ctx.restore()
            }
          } else {
            drawStar(ctx, cx, cy, op.size / 2, op.colorOff)
          }
        })
        if (op.valueText) {
          ctx.save()
          ctx.font = op.valueFont
          ctx.fillStyle = op.valueColor
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          const lastCx = op.x + op.size / 2 + 4 * op.size * 1.15
          ctx.fillText(op.valueText, lastCx + op.size * 0.7, op.y + op.size / 2)
          ctx.restore()
        }
        break
      }
      case 'chips':
        ctx.save()
        ctx.font = op.font
        op.chips.forEach((chip) => {
          pathRoundRect(ctx, chip.x, chip.y, chip.w, chip.h, chip.h / 2)
          ctx.fillStyle = op.bg
          ctx.fill()
          ctx.fillStyle = op.color
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          ctx.fillText(chip.text, chip.x + chip.w / 2, chip.y + chip.h / 2 + 1)
        })
        ctx.restore()
        break
      case 'image': {
        ctx.save()
        pathRoundRect(ctx, op.x, op.y, op.w, op.h, op.r)
        ctx.clip()
        // object-fit: cover 居中裁剪（PRD §8.5）
        const iw = op.img.width
        const ih = op.img.height
        const scale = Math.max(op.w / iw, op.h / ih)
        const sw = op.w / scale
        const sh = op.h / scale
        ctx.drawImage(op.img.source, (iw - sw) / 2, (ih - sh) / 2, sw, sh, op.x, op.y, op.w, op.h)
        ctx.restore()
        break
      }
      case 'placeholder': {
        // 菜系色矢量占位：同色系深浅两块 + 居中碗形圆
        ctx.save()
        pathRoundRect(ctx, op.x, op.y, op.w, op.h, op.r)
        ctx.fillStyle = `hsl(${op.hue} 32% 88%)`
        ctx.fill()
        ctx.clip()
        ctx.fillStyle = `hsl(${op.hue} 38% 80%)`
        const bowlR = Math.min(op.w, op.h) * 0.22
        ctx.beginPath()
        ctx.arc(op.x + op.w / 2, op.y + op.h / 2, bowlR, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `hsl(${op.hue} 30% 94%)`
        ctx.beginPath()
        ctx.arc(
          op.x + op.w / 2 - bowlR * 0.35,
          op.y + op.h / 2 - bowlR * 0.3,
          bowlR * 0.28,
          0,
          Math.PI * 2,
        )
        ctx.fill()
        ctx.restore()
        break
      }
    }
  }
}

/** 本地 Blob → 可绘制图片（objectURL 同源加载，EC-CARD-04；用完即 revoke） */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image decode failed'))
      img.src = url
    })
    return { source: img, width: img.naturalWidth, height: img.naturalHeight }
  } catch (err) {
    throw new CardRenderError('IMAGE_DECODE', '出片图片解码失败', { cause: err })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function measureFactory(): { measure: (text: string, font: string) => number } {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CardRenderError('EXPORT_FAILED', '无法创建测量画布')
  return {
    measure: (text: string, font: string) => {
      ctx.font = font
      return ctx.measureText(text).width
    },
  }
}

/** 渲染到离屏 Canvas（导出 PNG 用 scale=2，桌面 JPEG 小图用 scale=1） */
export async function renderToCanvas(
  data: CardData,
  template: CardTemplate,
  opts: { scale?: RenderScale } = {},
): Promise<HTMLCanvasElement> {
  const fontStatus = await ensureCardFonts()
  if (fontStatus === 'timeout') {
    // 字体超时不阻塞出片：回退系统字体继续（EC-CARD-05 的宽容策略）
    console.warn('[share-card] fonts not ready within timeout, fallback to system fonts')
  }

  const scale = opts.scale ?? CARD_SCALE
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * scale
  canvas.height = CARD_H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new CardRenderError('EXPORT_FAILED', '无法创建离屏画布')

  let image: LoadedImage | null = null
  if (data.photo) {
    image = await loadImage(data.photo)
  }

  const canvasMeasure = measureFactory()
  const ops = buildOps(template, data, {
    image,
    measure: (text, style) => {
      const family = style.family === 'title' ? template.fonts.title : template.fonts.body
      const font = `${style.weight} ${style.size}px ${family}`
      const base = canvasMeasure.measure(text, font)
      return style.letterSpacing ? base + style.letterSpacing * (text.length - 1) : base
    },
  })

  ctx.save()
  ctx.scale(scale, scale)
  executeOps(ctx, ops)
  ctx.restore()

  // 污染探测：跨域图片会让 getImageData 抛错，导出前显式校验（EC-CARD-04）
  try {
    ctx.getImageData(0, 0, 1, 1)
  } catch (err) {
    throw new CardRenderError('CARD_TAINTED', '画布被跨域图片污染，无法导出', { cause: err })
  }
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new CardRenderError('EXPORT_FAILED', '导出失败'))),
      type,
      quality,
    )
  })
}

/** 出片导出：1080×1440 PNG（分工文档 §3 交付物契约） */
export async function renderCard(data: CardData, template: CardTemplate): Promise<Blob> {
  const canvas = await renderToCanvas(data, template, { scale: 2 })
  return canvasToBlob(canvas, 'image/png')
}

/** 桌面端小尺寸 JPEG（PRD §8.5：便于即时通讯软件发送） */
export async function renderJpegCard(data: CardData, template: CardTemplate): Promise<Blob> {
  const canvas = await renderToCanvas(data, template, { scale: 1 })
  return canvasToBlob(canvas, 'image/jpeg', 0.85)
}
