/**
 * 图片压缩 Worker（Agent-3 独占文件，T1-08；规格 TDD §3.6）。
 * decode(createImageBitmap) → EXIF 方向纠正 → 长边 >1600 等比缩放 →
 * Laplacian 模糊预检 → 原图档 JPEG q0.82（超 ~500KB 降档 q0.75）→ 400px q0.7 缩略图。
 * 纯计算部分在 features/capture/image/*，本文件只做 Canvas 编排，便于单测覆盖。
 */
import {
  FALLBACK_QUALITY,
  ORIGINAL_QUALITY,
  TARGET_MAX_BYTES,
  THUMB_LONG_EDGE,
  THUMB_QUALITY,
  type CompressErrorCode,
  type CompressRequest,
  type CompressResponse,
  type CompressedImage,
} from '@/features/capture/image/compress'
import { parseExifOrientation } from '@/features/capture/image/exif'
import { computeTargetSize, orientedSize } from '@/features/capture/image/fit'
import { isBlurry, laplacianVariance, toGrayscale } from '@/features/capture/image/quality'

/** 收窄 self 类型，避免为单文件引入 webworker lib（与 DOM lib 冲突） */
interface WorkerScope {
  onmessage: ((e: MessageEvent<CompressRequest>) => void) | null
  postMessage(msg: CompressResponse, transfer?: Transferable[]): void
}

const ctx = self as unknown as WorkerScope

class PipelineError extends Error {
  constructor(
    readonly code: CompressErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PipelineError'
  }
}

/** 手工旋转（仅旧浏览器 from-image 不可用时兜底）；源宽高为未旋转口径 */
function applyOrientationTransform(
  c: OffscreenCanvasRenderingContext2D,
  orientation: number,
  w: number,
  h: number,
): void {
  switch (orientation) {
    case 2:
      c.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      c.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      c.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      c.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      c.transform(0, 1, -1, 0, h, 0)
      break
    case 7:
      c.transform(0, -1, -1, 0, h, w)
      break
    case 8:
      c.transform(0, -1, 1, 0, 0, w)
      break
    default:
      break
  }
}

async function handle(req: CompressRequest): Promise<CompressedImage> {
  const blob = new Blob([req.buffer], { type: req.mime || 'image/jpeg' })

  let appliedFromImage = false
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
    appliedFromImage = true
  } catch {
    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      throw new PipelineError('DECODE_FAILED', `cannot decode image (${req.mime || 'unknown'})`)
    }
  }

  try {
    const exifOrientation = parseExifOrientation(req.buffer) ?? 1
    // from-image 已纠正方向；未纠正时先以全分辨率绘出正立图（宽高按 orientation 互换）
    const needManualRotate = !appliedFromImage && exifOrientation !== 1
    const display = needManualRotate
      ? orientedSize(bitmap.width, bitmap.height, exifOrientation)
      : { width: bitmap.width, height: bitmap.height }
    let full: ImageBitmap | OffscreenCanvas = bitmap
    if (needManualRotate) {
      const fullCanvas = new OffscreenCanvas(display.width, display.height)
      const fc = fullCanvas.getContext('2d')
      if (!fc) throw new PipelineError('ENCODE_FAILED', '2d context unavailable')
      applyOrientationTransform(fc, exifOrientation, bitmap.width, bitmap.height)
      fc.drawImage(bitmap, 0, 0)
      full = fullCanvas
    }

    // 原图档：长边 >1600 等比缩放
    const target = computeTargetSize(display.width, display.height, req.maxLongEdge ?? 1600)
    const canvas = new OffscreenCanvas(target.width, target.height)
    const c = canvas.getContext('2d')
    if (!c) throw new PipelineError('ENCODE_FAILED', '2d context unavailable')
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(full, 0, 0, target.width, target.height)

    // 模糊预检（提示性，不阻塞）
    const gray = toGrayscale(c.getImageData(0, 0, target.width, target.height).data)
    const blurVariance = laplacianVariance(gray, target.width, target.height)

    // 原图档编码：q0.82，超 ~500KB 降档 q0.75
    const q0 = req.quality ?? ORIGINAL_QUALITY
    let encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: q0 })
    let qualityUsed = q0
    if (encoded.size > TARGET_MAX_BYTES && q0 > FALLBACK_QUALITY) {
      encoded = await canvas.convertToBlob({ type: 'image/jpeg', quality: FALLBACK_QUALITY })
      qualityUsed = FALLBACK_QUALITY
    }

    // 缩略图：400px 长边 q0.7（列表用）
    let thumb: ArrayBuffer | null = null
    const thumbEdge = req.thumbLongEdge ?? THUMB_LONG_EDGE
    if (thumbEdge > 0) {
      const t = computeTargetSize(target.width, target.height, thumbEdge)
      const tc = new OffscreenCanvas(t.width, t.height)
      const tctx = tc.getContext('2d')
      if (tctx) {
        tctx.imageSmoothingEnabled = true
        tctx.imageSmoothingQuality = 'high'
        tctx.drawImage(canvas, 0, 0, t.width, t.height)
        thumb = await (
          await tc.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY })
        ).arrayBuffer()
      }
    }

    return {
      blob: await encoded.arrayBuffer(),
      width: target.width,
      height: target.height,
      thumb,
      sizeBytes: encoded.size,
      blurVariance,
      blur: isBlurry(blurVariance),
      orientation: exifOrientation,
      qualityUsed,
    }
  } finally {
    bitmap.close()
  }
}

ctx.onmessage = (e: MessageEvent<CompressRequest>) => {
  const req = e.data
  void handle(req).then(
    (image) =>
      ctx.postMessage({ type: 'compressed', id: req.id, image }, [
        image.blob,
        ...(image.thumb ? [image.thumb] : []),
      ]),
    (err: unknown) => {
      const code = err instanceof PipelineError ? err.code : 'ENCODE_FAILED'
      const message = err instanceof Error ? err.message : String(err)
      ctx.postMessage({ type: 'error', id: req.id, code, message })
    },
  )
}
