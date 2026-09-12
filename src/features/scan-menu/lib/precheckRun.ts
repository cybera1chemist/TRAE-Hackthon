/**
 * 预检解码（T3-01 浏览器侧）：File → createImageBitmap → 缩放灰度 → blur/glare/tooDark。
 * 纯函数 detectBlur/detectExposure 仍在 lib/precheck（Node 单测覆盖）；
 * 本模块只做浏览器 API 编排，失败时静默放行（预检是提示性，不阻塞上传，EC-MENU-02）。
 * Agent-3 image.worker 交付后可整体迁移至 Worker 内执行，签名不变。
 */
import type { ImagePrecheck } from '../types'
import { detectBlur, detectExposure } from './precheck'

const PRECHECK_LONG_EDGE = 640

export interface ImagePrecheckResult extends ImagePrecheck {
  /** 原图像素尺寸（Photo 登记用；解码失败时缺省） */
  width?: number
  height?: number
}

export async function analyzeImagePrecheck(file: File): Promise<ImagePrecheckResult> {
  try {
    const bitmap = await createImageBitmap(file)
    const width = bitmap.width
    const height = bitmap.height
    const longEdge = Math.max(bitmap.width, bitmap.height)
    const scale = longEdge > PRECHECK_LONG_EDGE ? PRECHECK_LONG_EDGE / longEdge : 1
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { blur: false, glare: false, tooDark: false }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const { data } = ctx.getImageData(0, 0, w, h)
    const gray = new Uint8ClampedArray(w * h)
    for (let i = 0; i < gray.length; i += 1) {
      gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
    }
    const grayImage = { data: gray, width: w, height: h }
    const exposure = detectExposure(grayImage)
    return {
      blur: detectBlur(grayImage),
      glare: exposure.glare,
      tooDark: exposure.tooDark,
      width,
      height,
    }
  } catch {
    // 解码失败（HEIC 等）不阻塞上传，仅放弃预检提示
    return { blur: false, glare: false, tooDark: false }
  }
}
