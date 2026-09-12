import { describe, expect, it } from 'vitest'
import { parseExifOrientation } from '@/features/capture/image/exif'
import { computeTargetSize, orientedSize } from '@/features/capture/image/fit'
import {
  laplacianVariance,
  toGrayscale,
  isBlurry,
  BLUR_VARIANCE_THRESHOLD,
} from '@/features/capture/image/quality'
import { checkMime } from '@/features/capture/image/validate'

/**
 * image.worker 管线纯函数单测（T1-08；Canvas 编排部分由 Playwright E2E 覆盖）。
 */

/** 构造带 EXIF orientation 的最小 JPEG 字节（SOI + APP1(Exif) + EOI） */
function jpegWithExif(byteOrder: 'II' | 'MM', orientation: number): ArrayBuffer {
  const le = byteOrder === 'II'
  const u8 = new Uint8Array(2 + 2 + 34 + 2)
  let p = 0
  const push = (...b: number[]) => u8.set(b, (p += b.length) - b.length)

  push(0xff, 0xd8) // SOI
  push(0xff, 0xe1, 0x00, 34) // APP1，段长 = 2(自身) + 6 + 8 + 2 + 12 + 4
  for (const ch of 'Exif\0\0') push(ch.charCodeAt(0))
  // TIFF 头：字节序 + 42 + IFD0 偏移 8
  if (le) push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00)
  else push(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08)
  // IFD0：1 个条目 + next IFD 0
  push(0x00, 0x01)
  push(...(le ? [0x12, 0x01] : [0x01, 0x12])) // tag 0x0112
  push(...(le ? [0x03, 0x00] : [0x00, 0x03])) // type SHORT
  push(...(le ? [0x01, 0x00, 0x00, 0x00] : [0x00, 0x00, 0x00, 0x01]))
  push(...(le ? [orientation, 0x00, 0x00, 0x00] : [0x00, orientation, 0x00, 0x00]))
  push(0x00, 0x00, 0x00, 0x00)
  push(0xff, 0xd9) // EOI
  return u8.buffer
}

describe('parseExifOrientation', () => {
  it('解析小端（II）与大端（MM）的 orientation', () => {
    expect(parseExifOrientation(jpegWithExif('II', 6))).toBe(6)
    expect(parseExifOrientation(jpegWithExif('MM', 8))).toBe(8)
    expect(parseExifOrientation(jpegWithExif('II', 1))).toBe(1)
  })

  it('非 JPEG / 无 EXIF / 非法值返回 undefined', () => {
    expect(parseExifOrientation(new ArrayBuffer(16))).toBeUndefined()
    // JPEG 但只有 APP0(JFIF)：SOI + APP0(len 16) + "JFIF\0"
    const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00])
    expect(parseExifOrientation(jfif.buffer)).toBeUndefined()
    expect(parseExifOrientation(jpegWithExif('II', 99))).toBeUndefined()
  })
})

describe('computeTargetSize / orientedSize', () => {
  it('长边 >1600 等比缩放（TDD §3.6 验收：1600 长边）', () => {
    expect(computeTargetSize(4000, 3000)).toEqual({ width: 1600, height: 1200, scaled: true })
    expect(computeTargetSize(800, 2400)).toEqual({ width: 533, height: 1600, scaled: true })
  })

  it('长边不超限时原样返回；自定义上限用于缩略图 400', () => {
    expect(computeTargetSize(1600, 1200)).toEqual({ width: 1600, height: 1200, scaled: false })
    expect(computeTargetSize(800, 600, 400)).toEqual({ width: 400, height: 300, scaled: true })
  })

  it('orientation 5–8 显示宽高互换，其余不换', () => {
    expect(orientedSize(4000, 3000, 6)).toEqual({ width: 3000, height: 4000 })
    expect(orientedSize(4000, 3000, 1)).toEqual({ width: 4000, height: 3000 })
    expect(orientedSize(4000, 3000)).toEqual({ width: 4000, height: 3000 })
  })
})

describe('laplacianVariance / isBlurry', () => {
  it('纯色图方差为 0 → blur（无纹理视为低质量）', () => {
    const w = 32
    const h = 32
    const gray = new Float64Array(w * h).fill(100)
    const v = laplacianVariance(gray, w, h)
    expect(v).toBe(0)
    expect(isBlurry(v)).toBe(true)
  })

  it('棋盘格高频图方差远超阈值 → 不 blur', () => {
    const w = 32
    const h = 32
    const gray = new Float64Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) gray[y * w + x] = (x + y) % 2 === 0 ? 0 : 255
    const v = laplacianVariance(gray, w, h)
    expect(v).toBeGreaterThan(BLUR_VARIANCE_THRESHOLD)
    expect(isBlurry(v)).toBe(false)
  })

  it('宽高不足 3 返回 0；灰度转换符合 BT.601', () => {
    expect(laplacianVariance(new Float64Array(4), 2, 2)).toBe(0)
    const g = toGrayscale(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]))
    expect(g[0]).toBeCloseTo(0.299 * 255, 6)
    expect(g[1]).toBeCloseTo(0.587 * 255, 6)
  })
})

describe('checkMime（EC-CAP-03）', () => {
  it('jpeg/png/webp 通过；heic/heif 单独提示；其余拒绝', () => {
    expect(checkMime('image/jpeg')).toBe('ok')
    expect(checkMime('IMAGE/PNG')).toBe('ok')
    expect(checkMime('image/webp')).toBe('ok')
    expect(checkMime('image/heic')).toBe('heic')
    expect(checkMime('image/heif')).toBe('heic')
    expect(checkMime('image/gif')).toBe('unsupported')
    expect(checkMime('')).toBe('unsupported')
  })
})
