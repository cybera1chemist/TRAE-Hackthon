/**
 * BlobStore 的 IndexedDB 适配器（T1-04，TDD §3.6 / 分工 §3 交付物）
 *
 * - 图片 Blob 存独立 Dexie 库 fooddex-blobs，与业务事务解耦；
 * - key 形如 idb://blobs/<key>，与 InMemory 版口径一致；
 * - usage() 读 navigator.storage.estimate()；persistStorage() 请求防清理授权。
 */
import type { BlobStore } from '@/infra/db/repositories'
import { BlobDatabase, type BlobRecord } from '@/infra/db/database'

export const BLOB_KEY_PREFIX = 'idb://blobs/'

export function normalizeBlobKey(key: string): string {
  return key.startsWith(BLOB_KEY_PREFIX) ? key : `${BLOB_KEY_PREFIX}${key}`
}

export class IdbBlobStore implements BlobStore {
  constructor(private readonly blobDb: BlobDatabase = new BlobDatabase()) {}

  async put(key: string, blob: Blob): Promise<string> {
    const k = normalizeBlobKey(key)
    const record: BlobRecord = {
      key: k,
      blob,
      sizeBytes: blob.size,
      createdAt: new Date().toISOString(),
    }
    await this.blobDb.blobs.put(record)
    return k
  }

  async get(key: string): Promise<Blob | undefined> {
    const record = await this.blobDb.blobs.get(normalizeBlobKey(key))
    return record?.blob
  }

  async delete(key: string): Promise<void> {
    await this.blobDb.blobs.delete(normalizeBlobKey(key))
  }

  async usage(): Promise<{ usage: number; quota: number }> {
    return estimateStorage()
  }

  /** 仅供存储管理（T5-06）使用：按 key 批量删 */
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    await this.blobDb.blobs.bulkDelete(keys.map(normalizeBlobKey))
  }

  /** 仅供存储管理：全部 Blob 记录（key + 大小 + 时间） */
  async listRecords(): Promise<Array<{ key: string; sizeBytes: number; createdAt: string }>> {
    const all = await this.blobDb.blobs.toCollection().toArray()
    return all.map((r) => ({ key: r.key, sizeBytes: r.sizeBytes, createdAt: r.createdAt }))
  }
}

// ── 配额与持久化授权（TDD §3.6，PRD EC-CAP-07） ──────────────────────────────

export interface StorageEstimate {
  usage: number
  quota: number
}

/** 浏览器存储配额；不支持时 quota=0（调用方按未知处理） */
export async function estimateStorage(): Promise<StorageEstimate> {
  const nav = globalThis.navigator as Navigator | undefined
  if (nav?.storage?.estimate) {
    const e = await nav.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  }
  return { usage: 0, quota: 0 }
}

/** 请求持久化存储授权（防系统清理，TDD §7.2） */
export async function persistStorage(): Promise<boolean> {
  const nav = globalThis.navigator as
    | (Navigator & {
        storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
      })
    | undefined
  return nav?.storage?.persist ? nav.storage.persist() : false
}

export async function isStoragePersisted(): Promise<boolean> {
  const nav = globalThis.navigator as
    | (Navigator & {
        storage?: { persisted?: () => Promise<boolean> }
      })
    | undefined
  return nav?.storage?.persisted ? nav.storage.persisted() : false
}
