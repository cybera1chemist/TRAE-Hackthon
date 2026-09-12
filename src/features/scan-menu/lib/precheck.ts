/**
 * 上传预检（T3-01 / EC-MENU-01/02 / TDD §3.6）。
 * 纯函数设计：validateImageFiles 只依赖文件元信息；blur/glare 依赖灰度像素数据，
 * File → 灰度的 decode 在 image worker 内完成（Agent-3 的 image.worker），
 * 本模块不做任何浏览器 API 调用，保证 Node 单测可跑。
 */

export const MAX_MENU_IMAGES = 10
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const

export type ImageRejectReason = 'COUNT_EXCEEDED' | 'SIZE_EXCEEDED' | 'TYPE_UNSUPPORTED'

export interface ImageFileMeta {
  name: string
  type: string
  size: number
}

export interface ImageValidation {
  index: number
  ok: boolean
  reason?: ImageRejectReason
}

/**
 * 多图上传校验（EC-MENU-01：最多 10 张 / 单张 ≤10MB）。
 * 按顺序处理：类型与大小不合格的直接拒绝；数量超限的部分按 COUNT_EXCEEDED 拒绝。
 */
export function validateImageFiles(
  metas: ImageFileMeta[],
  currentCount: number,
  opts: { maxCount?: number; maxBytes?: number } = {},
): ImageValidation[] {
  const maxCount = opts.maxCount ?? MAX_MENU_IMAGES
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES
  let slotLeft = Math.max(0, maxCount - currentCount)
  return metas.map((meta, index) => {
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(meta.type)) {
      return { index, ok: false, reason: 'TYPE_UNSUPPORTED' as const }
    }
    if (meta.size > maxBytes) {
      return { index, ok: false, reason: 'SIZE_EXCEEDED' as const }
    }
    if (slotLeft <= 0) {
      return { index, ok: false, reason: 'COUNT_EXCEEDED' as const }
    }
    slotLeft -= 1
    return { index, ok: true }
  })
}

/** 灰度图最小接口（与 ImageData.data 兼容，便于单测构造） */
export interface GrayImage {
  data: ArrayLike<number>
  width: number
  height: number
}

/** Laplacian 4 邻域算子（跳过 1px 边界），返回方差；方差低于阈值视为模糊（TDD §3.6） */
export function laplacianVariance(img: GrayImage): number {
  const { data, width, height } = img
  if (width < 3 || height < 3) return 0
  const values: number[] = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const lap = data[i - 1] + data[i + 1] + data[i - width] + data[i + width] - 4 * data[i]
      values.push(lap)
    }
  }
  const n = values.length
  if (n === 0) return 0
  let sum = 0
  let sumSq = 0
  for (const v of values) {
    sum += v
    sumSq += v * v
  }
  const mean = sum / n
  return sumSq / n - mean * mean
}

export const BLUR_VARIANCE_THRESHOLD = 60

export function detectBlur(img: GrayImage, threshold = BLUR_VARIANCE_THRESHOLD): boolean {
  return laplacianVariance(img) < threshold
}

/** 曝光预检（EC-MENU-02 反光/过暗提示）：过曝（≥246）或过暗（≤12）像素占比超阈值即提示 */
export const GLARE_RATIO_THRESHOLD = 0.15
export const DARK_RATIO_THRESHOLD = 0.3

export interface ExposureResult {
  glare: boolean
  tooDark: boolean
  overexposedRatio: number
  underexposedRatio: number
}

export function detectExposure(img: GrayImage): ExposureResult {
  const n = img.data.length
  if (n === 0) {
    return { glare: false, tooDark: false, overexposedRatio: 0, underexposedRatio: 0 }
  }
  let over = 0
  let under = 0
  for (let i = 0; i < n; i += 1) {
    const v = img.data[i]
    if (v >= 246) over += 1
    else if (v <= 12) under += 1
  }
  const overexposedRatio = over / n
  const underexposedRatio = under / n
  return {
    glare: overexposedRatio > GLARE_RATIO_THRESHOLD,
    tooDark: underexposedRatio > DARK_RATIO_THRESHOLD,
    overexposedRatio,
    underexposedRatio,
  }
}
