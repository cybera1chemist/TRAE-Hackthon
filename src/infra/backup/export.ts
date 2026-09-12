/**
 * 备份导出（T5-05）—— Agent-1
 * 读取业务库全部核心表；图片可选 base64 随包，并按 ≤50MB 切分图片卷。
 */
import type { FoodDexDatabase } from '@/infra/db/database'
import type { IdbBlobStore } from '@/infra/blob/IdbBlobStore'
import {
  BACKUP_APP,
  MAX_VOLUME_BYTES,
  type BackupData,
  type BackupPackage,
  type PhotoBlobEntry,
  type PhotoVolume,
} from './format'
import { SCHEMA_VERSION } from '@/infra/db/schema'

// ── 浏览器安全的 base64 工具（btoa/atob + Uint8Array，jsdom 同样可用） ────────

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function base64ToBlob(dataBase64: string, mediaType: string): Blob {
  const bin = atob(dataBase64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mediaType || 'application/octet-stream' })
}

async function readBackupData(db: FoodDexDatabase): Promise<BackupData> {
  const [userProfile, restaurants, dishes, logs, photos, tagVocab, menuScans, ocrItems] =
    await Promise.all([
      db.userProfile.toArray(),
      db.restaurants.toArray(),
      db.dishes.toArray(),
      db.logs.toArray(),
      db.photos.toArray(),
      db.tagVocab.toArray(),
      db.menuScans.toArray(),
      db.ocrItems.toArray(),
    ])
  return { userProfile, restaurants, dishes, logs, photos, tagVocab, menuScans, ocrItems }
}

export interface ExportResult {
  pkg: BackupPackage
  /** 图片卷（photos='base64' 时可能多卷；'none' 时为空数组） */
  photoVolumes: PhotoVolume[]
  /** 导出的图片数量与总字节 */
  photoCount: number
  photoBytes: number
}

/** 导出备份包（内存中完成；文件落盘/下载由设置页 Agent 处理） */
export async function exportBackup(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
  options: { photos: 'base64' | 'none' },
): Promise<ExportResult> {
  const exportedAt = new Date().toISOString()
  const data = await readBackupData(db)

  const pkg: BackupPackage = {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    photos: options.photos,
    data,
  }

  if (options.photos === 'none' || data.photos.length === 0) {
    return { pkg, photoVolumes: [], photoCount: 0, photoBytes: 0 }
  }

  // 读取全部图片 Blob 转 base64（去重，避免同 key 重复编码）
  const keys = [...new Set(data.photos.map((p) => p.blobKey))]
  const entries: PhotoBlobEntry[] = []
  let photoBytes = 0
  for (const key of keys) {
    const blob = await blobStore.get(key)
    if (!blob) continue
    photoBytes += blob.size
    entries.push({
      key,
      mediaType: blob.type || 'image/jpeg',
      dataBase64: await blobToBase64(blob),
    })
  }

  // 按 base64 长度贪心装箱（每卷 ≤ MAX_VOLUME_BYTES）
  const volumes: PhotoVolume[] = []
  let current: PhotoBlobEntry[] = []
  let currentSize = 0
  for (const entry of entries) {
    const size = entry.dataBase64.length
    if (currentSize + size > MAX_VOLUME_BYTES && current.length > 0) {
      volumes.push(makeVolume(exportedAt, current, volumes.length, 0))
      current = []
      currentSize = 0
    }
    current.push(entry)
    currentSize += size
  }
  if (current.length > 0) volumes.push(makeVolume(exportedAt, current, volumes.length, 0))
  const total = volumes.length
  for (let i = 0; i < total; i++) volumes[i].total = total

  return { pkg, photoVolumes: volumes, photoCount: entries.length, photoBytes }
}

function makeVolume(
  exportedAt: string,
  blobs: PhotoBlobEntry[],
  index: number,
  total: number,
): PhotoVolume {
  return {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    part: 'photos',
    index,
    total,
    blobs,
  }
}

/** 序列化为可下载的 JSON 文本 */
export function stringifyBackup(pkg: BackupPackage): string {
  return JSON.stringify(pkg)
}

export function stringifyVolume(volume: PhotoVolume): string {
  return JSON.stringify(volume)
}

/** 解析并校验备份/卷文本 */
export function parseBackupText(text: string): unknown {
  return JSON.parse(text)
}

export function isPhotoVolume(value: unknown): value is PhotoVolume {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { part?: string }).part === 'photos' &&
    Array.isArray((value as PhotoVolume).blobs)
  )
}
