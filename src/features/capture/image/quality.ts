/**
 * 模糊预检（TDD §3.6：灰度化 → Laplacian 方差 < 阈值 → blur=true）。
 * hasFood 本地不做（TDD §3.6：v1.0 依赖云端识别返回，不阻塞）。纯函数，jsdom 可测。
 */

/** RGBA → 亮度灰度（ITU-R BT.601） */
export function toGrayscale(rgba: Uint8ClampedArray): Float64Array {
  const n = rgba.length / 4
  const gray = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    gray[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]
  }
  return gray
}

/** 4 邻域 Laplacian 响应方差（仅内部像素；边长 <3 返回 0） */
export function laplacianVariance(gray: ArrayLike<number>, width: number, height: number): number {
  if (width < 3 || height < 3) return 0
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      sum += l
      sumSq += l * l
      count++
    }
  }
  if (count === 0) return 0
  const mean = sum / count
  return sumSq / count - mean * mean
}

/**
 * blur 判定阈值（0–255 灰度经验值）。
 * 提示性预检、不阻塞（PRD §5.1.1「仍要识别」），待真机样本标定后调整。
 */
export const BLUR_VARIANCE_THRESHOLD = 120

export function isBlurry(variance: number, threshold: number = BLUR_VARIANCE_THRESHOLD): boolean {
  return variance < threshold
}
