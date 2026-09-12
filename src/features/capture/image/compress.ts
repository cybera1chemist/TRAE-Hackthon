/**
 * image.worker 的页面侧入口（T1-08，分工 §3 交付物签名 `compressImage(file)`）。
 * 协议：请求 CompressRequest → 成功 {type:'compressed'} / 失败 {type:'error'}。
 * 错误码对齐 PRD 边界用例：EC-CAP-03（Worker 外的 checkMime）、
 * EC-CAP-05（>10MB 且压缩失败 → 页面层提示重新选择）。
 */

export interface CompressRequest {
  id: number
  /** File 读出的 ArrayBuffer（传输所有权，Worker 内自行包 Blob） */
  buffer: ArrayBuffer
  mime: string
  /** 原图档长边上限，默认 1600 */
  maxLongEdge?: number
  /** 原图档初始质量，默认 0.82（超 ~500KB 自动降档 0.75） */
  quality?: number
  /** 缩略图长边，默认 400；传 0 跳过 */
  thumbLongEdge?: number
}

export interface CompressedImage {
  /** 原图档 JPEG（q0.82，超约 500KB 降档 q0.75） */
  blob: ArrayBuffer
  width: number
  height: number
  /** 缩略图 JPEG（400px 长边 q0.7，列表用）；thumbLongEdge=0 时为 null */
  thumb: ArrayBuffer | null
  sizeBytes: number
  /** 本地模糊预检得分与判定（提示性，不阻塞） */
  blurVariance: number
  blur: boolean
  /** 已应用的 EXIF 方向（1–8） */
  orientation: number
  /** 实际编码质量（发生降档时小于请求值） */
  qualityUsed: number
}

export type CompressErrorCode = 'DECODE_FAILED' | 'ENCODE_FAILED' | 'TOO_LARGE'

export type CompressResponse =
  | { type: 'compressed'; id: number; image: CompressedImage }
  | { type: 'error'; id: number; code: CompressErrorCode; message: string }

export const ORIGINAL_QUALITY = 0.82
export const FALLBACK_QUALITY = 0.75
export const TARGET_MAX_BYTES = 500 * 1024
export const THUMB_LONG_EDGE = 400
export const THUMB_QUALITY = 0.7

export interface CompressOptions {
  maxLongEdge?: number
  quality?: number
  thumbLongEdge?: number
  /** 测试注入用；生产默认以 Vite new URL 方式加载模块 Worker */
  createWorker?: () => Worker
}

let seq = 0

/** 压缩单张图片：等比缩放 + EXIF 纠正 + blur 预检 + 原图档/缩略图输出 */
export function compressImage(file: File, options: CompressOptions = {}): Promise<CompressedImage> {
  const spawn =
    options.createWorker ??
    (() =>
      new Worker(new URL('../../../workers/image.worker.ts', import.meta.url), { type: 'module' }))
  const worker = spawn()
  const id = ++seq

  return new Promise<CompressedImage>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.terminate()
    }
    const onMessage = (e: MessageEvent<CompressResponse>) => {
      const msg = e.data
      if (!msg || msg.id !== id) return
      cleanup()
      if (msg.type === 'compressed') resolve(msg.image)
      else reject(new Error(`[${msg.code}] ${msg.message}`))
    }
    const onError = () => {
      cleanup()
      reject(new Error('[image.worker] worker crashed'))
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    void file.arrayBuffer().then((buffer) => {
      worker.postMessage(
        {
          id,
          buffer,
          mime: file.type,
          maxLongEdge: options.maxLongEdge,
          quality: options.quality,
          thumbLongEdge: options.thumbLongEdge,
        } satisfies CompressRequest,
        [buffer],
      )
    }, onError)
  })
}
