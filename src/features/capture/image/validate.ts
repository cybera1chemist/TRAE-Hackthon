/**
 * 上传前 MIME 校验（PRD EC-CAP-03：非图片 / HEIC 提示转换或改走系统相册导出）。
 */

export type MimeCheckResult = 'ok' | 'heic' | 'unsupported'

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const HEIC_FAMILY = new Set(['image/heic', 'image/heif'])

export function checkMime(mime: string): MimeCheckResult {
  const m = mime.toLowerCase().split(';')[0].trim()
  if (ACCEPTED.has(m)) return 'ok'
  if (HEIC_FAMILY.has(m)) return 'heic'
  return 'unsupported'
}
