import { describe, expect, it } from 'vitest'
import {
  detectBlur,
  detectExposure,
  laplacianVariance,
  validateImageFiles,
  type GrayImage,
} from '@/features/scan-menu'

/** T3-01 预检纯函数（EC-MENU-01/02）：上传数量/大小/类型 + blur/曝光 */
describe('validateImageFiles', () => {
  const jpeg = (size: number): { name: string; type: string; size: number } => ({
    name: 'menu.jpg',
    type: 'image/jpeg',
    size,
  })

  it('正常图片通过', () => {
    const result = validateImageFiles([jpeg(5 * 1024 * 1024)], 0)
    expect(result).toEqual([{ index: 0, ok: true }])
  })

  it('类型不支持 → TYPE_UNSUPPORTED', () => {
    const result = validateImageFiles([{ name: 'a.gif', type: 'image/gif', size: 100 }], 0)
    expect(result[0]).toMatchObject({ ok: false, reason: 'TYPE_UNSUPPORTED' })
  })

  it('超过 10MB → SIZE_EXCEEDED', () => {
    const result = validateImageFiles([jpeg(10 * 1024 * 1024 + 1)], 0)
    expect(result[0]).toMatchObject({ ok: false, reason: 'SIZE_EXCEEDED' })
  })

  it('超出剩余槽位 → COUNT_EXCEEDED（EC-MENU-01 最多 10 张）', () => {
    const metas = Array.from({ length: 4 }, () => jpeg(100))
    const result = validateImageFiles(metas, 8)
    expect(result.filter((r) => r.ok)).toHaveLength(2)
    expect(result.filter((r) => r.reason === 'COUNT_EXCEEDED')).toHaveLength(2)
  })
})

describe('blur / exposure 预检（TDD §3.6）', () => {
  const flat: GrayImage = {
    data: new Uint8ClampedArray(30 * 30).fill(128),
    width: 30,
    height: 30,
  }

  const checkerboard: GrayImage = {
    data: Uint8ClampedArray.from({ length: 30 * 30 }, (_, i) => ((i + ((i / 30) | 0)) % 2) * 255),
    width: 30,
    height: 30,
  }

  it('纯色图 Laplacian 方差为 0 → 判模糊', () => {
    expect(laplacianVariance(flat)).toBe(0)
    expect(detectBlur(flat)).toBe(true)
  })

  it('棋盘图方差远高于阈值 → 不模糊', () => {
    expect(laplacianVariance(checkerboard)).toBeGreaterThan(60)
    expect(detectBlur(checkerboard)).toBe(false)
  })

  it('过曝占比超 15% → glare 提示（反光）', () => {
    const data = new Uint8ClampedArray(100).fill(30)
    for (let i = 0; i < 20; i += 1) data[i] = 250
    const result = detectExposure({ data, width: 10, height: 10 })
    expect(result.overexposedRatio).toBeCloseTo(0.2)
    expect(result.glare).toBe(true)
    expect(result.tooDark).toBe(false)
  })

  it('过暗占比超 30% → tooDark 提示', () => {
    const data = new Uint8ClampedArray(100).fill(200)
    for (let i = 0; i < 40; i += 1) data[i] = 5
    const result = detectExposure({ data, width: 10, height: 10 })
    expect(result.underexposedRatio).toBeCloseTo(0.4)
    expect(result.tooDark).toBe(true)
    expect(result.glare).toBe(false)
  })
})
