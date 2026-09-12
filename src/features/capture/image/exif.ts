/**
 * EXIF Orientation 解析（TDD §3.6 方向纠正）。
 * createImageBitmap 的 imageOrientation:'from-image' 在部分旧浏览器不可用，
 * 此时以本解析结果手工旋转。纯函数，Node/jsdom 可测。
 */

const SOI = 0xffd8
const APP1 = 0xffe1
const SOS = 0xffda
const EXIF_HEADER = 'Exif\0\0'
const ORIENTATION_TAG = 0x0112
const TYPE_SHORT = 3

/** 解析 JPEG 的 EXIF orientation（1–8）；非 JPEG / 无 EXIF / 非法值返回 undefined */
export function parseExifOrientation(buffer: ArrayBuffer): number | undefined {
  const view = new DataView(buffer)
  if (buffer.byteLength < 4 || view.getUint16(0) !== SOI) return undefined

  let offset = 2
  while (offset + 4 <= buffer.byteLength) {
    const marker = view.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) return undefined
    const segLen = view.getUint16(offset + 2)
    if (marker === APP1) {
      if (readAscii(view, offset + 4, 6) === EXIF_HEADER) {
        return readOrientation(view, offset + 4 + 6)
      }
    } else if (marker === SOS) {
      return undefined // 进入扫描数据后不会再有 EXIF 段
    }
    offset += 2 + segLen
  }
  return undefined
}

function readAscii(view: DataView, at: number, len: number): string {
  if (at + len > view.byteLength) return ''
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(at + i))
  return s
}

function readOrientation(view: DataView, tiff: number): number | undefined {
  if (tiff + 8 > view.byteLength) return undefined
  const bo = view.getUint16(tiff)
  const le = bo === 0x4949 // "II" 小端；"MM" 大端
  if (!le && bo !== 0x4d4d) return undefined
  if (view.getUint16(tiff + 2, le) !== 0x002a) return undefined

  const ifd0 = tiff + view.getUint32(tiff + 4, le)
  if (ifd0 + 2 > view.byteLength) return undefined
  const count = view.getUint16(ifd0, le)
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12
    if (entry + 12 > view.byteLength) return undefined
    if (view.getUint16(entry, le) !== ORIENTATION_TAG) continue
    if (view.getUint16(entry + 2, le) !== TYPE_SHORT) return undefined
    const value = view.getUint16(entry + 8, le)
    return value >= 1 && value <= 8 ? value : undefined
  }
  return undefined
}
