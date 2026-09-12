/**
 * 出片导出与分享（T5-04）：
 * - 保存：File System Access API 可用时优先「保存」，否则 <a download>；
 * - 分享：navigator.share({files})，不支持时返回 'unsupported' 由 UI 提示长按保存（T5-04 验收）。
 */
import { CardRenderError, type CardData } from './types'
import { buildCardFilename } from './rarity'

export type SaveResult = 'fsa' | 'download'

type WritableLike = { write: (d: BlobPart) => Promise<void>; close: () => Promise<void> }
type PickerHandle = { createWritable: () => Promise<WritableLike> }

function hasFSA(): boolean {
  if (typeof window === 'undefined') return false
  return (
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  )
}

export async function saveBlob(blob: Blob, filename: string): Promise<SaveResult> {
  if (hasFSA()) {
    try {
      const picker = (
        window as unknown as { showSaveFilePicker: (opts?: unknown) => Promise<PickerHandle> }
      ).showSaveFilePicker
      const handle = await picker({ suggestedName: filename })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'fsa'
    } catch (err) {
      // 用户取消选择器（AbortError）时静默返回，不落 a.download
      if (err instanceof DOMException && err.name === 'AbortError') return 'fsa'
      console.warn('[share-card] FSA save failed, fallback to a.download', err)
    }
  }
  if (typeof document === 'undefined') {
    throw new CardRenderError('EXPORT_FAILED', '非浏览器环境无法保存文件')
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'download'
}

/** 保存出片：文件名统一 fooddex_菜名_日期.png（PRD §8.5） */
export async function saveCard(data: CardData, blob: Blob, ext = 'png'): Promise<SaveResult> {
  return saveBlob(blob, buildCardFilename(data.dishName, data.ateAt, ext))
}

export type ShareResult = 'shared' | 'unsupported'

export async function shareCard(data: CardData, blob: Blob): Promise<ShareResult> {
  const filename = buildCardFilename(
    data.dishName,
    data.ateAt,
    blob.type === 'image/jpeg' ? 'jpg' : 'png',
  )
  if (typeof navigator === 'undefined' || navigator.share === undefined) return 'unsupported'
  const file = new File([blob], filename, { type: blob.type })
  const payload: ShareData & { files?: File[] } = {
    title: 'FoodDex 图鉴卡',
    text: `${data.dishName} · 我的美食图鉴`,
  }
  if (navigator.canShare !== undefined && navigator.canShare({ files: [file] })) {
    payload.files = [file]
    await navigator.share(payload)
    return 'shared'
  }
  return 'unsupported'
}
