/**
 * 缩放目标尺寸计算（TDD §3.6：长边 >1600 等比缩放；缩略图 400px 同规则）。
 */

export interface TargetSize {
  width: number
  height: number
  scaled: boolean
}

/** 长边超过 maxLongEdge 时等比缩小（四舍五入，最小 1px），否则原样返回 */
export function computeTargetSize(width: number, height: number, maxLongEdge = 1600): TargetSize {
  const long = Math.max(width, height)
  if (long <= maxLongEdge) return { width, height, scaled: false }
  const ratio = maxLongEdge / long
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  }
}

/** EXIF orientation 5–8 拍摄时已旋转 90°，显示宽高需互换 */
export function orientedSize(
  width: number,
  height: number,
  orientation?: number,
): { width: number; height: number } {
  return orientation !== undefined && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height }
}
