/**
 * 框选区域裁剪（EC-MENU-04 重扫）：原图 File → 指定 bbox 区域的 JPEG dataURL。
 * region 为原始图像素坐标（AI 输入未旋转，确认页覆盖层亦按原图方向绘制）。
 */
import type { BBox } from '@/domain/entities'

export async function cropRegionToDataUrl(file: File, region: BBox): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const x = Math.max(0, Math.floor(region.x))
    const y = Math.max(0, Math.floor(region.y))
    const w = Math.min(bitmap.width - x, Math.ceil(region.w))
    const h = Math.min(bitmap.height - y, Math.ceil(region.h))
    if (w <= 0 || h <= 0) throw new Error('框选区域超出图片范围')
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 不可用')
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.92)
  } finally {
    bitmap.close()
  }
}
