/**
 * 存储管理（T5-06，PRD §5.5 / TDD §7.2）—— Agent-1
 *
 *  - 占用展示：Blob 字节数、配额、各表行数；
 *  - 仅留近一年图：删除近 365 天之前 Log 关联的图片（Blob + Photo 行），文字保留；
 *  - 清空图片保文字：删全部图片，Log/图鉴状态不受影响。
 *
 * Blob 独立库与业务库不能跨库事务：先删 Blob（失败即中止，不产生孤儿引用），
 * 再在业务事务内删 Photo 行并清空 Log.photoIds。
 */
import type { FoodDexDatabase } from '@/infra/db/database'
import type { IdbBlobStore } from './IdbBlobStore'

const DAY_MS = 24 * 60 * 60 * 1000

export interface StorageBreakdown {
  blobBytes: number
  quota: number
  counts: {
    restaurants: number
    dishes: number
    logs: number
    photos: number
    menuScans: number
  }
}

export async function getStorageBreakdown(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
): Promise<StorageBreakdown> {
  const [quota, blobRecords, restaurants, dishes, logs, photos, menuScans] = await Promise.all([
    blobStore.usage(),
    blobStore.listRecords(),
    db.restaurants.count(),
    db.dishes.count(),
    db.logs.count(),
    db.photos.count(),
    db.menuScans.count(),
  ])
  return {
    blobBytes: blobRecords.reduce((s, r) => s + r.sizeBytes, 0),
    quota: quota.quota,
    counts: { restaurants, dishes, logs, photos, menuScans },
  }
}

interface PrunePlan {
  photoIds: string[]
  blobKeys: string[]
  logIds: string[]
  freedBytes: number
}

/** 找出 cutoff 之前的 Log 关联的全部图片（近一年 cutoff 由调用方传入） */
async function buildOldImagePlan(db: FoodDexDatabase, cutoffIso: string): Promise<PrunePlan> {
  const oldLogs = await db.logs.where('ateAt').below(cutoffIso).toArray()
  const photoIds = new Set<string>()
  const logIds: string[] = []
  for (const log of oldLogs) {
    if (log.photoIds.length === 0) continue
    logIds.push(log.id)
    for (const id of log.photoIds) photoIds.add(id)
  }
  if (photoIds.size === 0) {
    return { photoIds: [], blobKeys: [], logIds: [], freedBytes: 0 }
  }
  const photos = await db.photos.bulkGet([...photoIds])
  let freedBytes = 0
  const blobKeys: string[] = []
  for (const p of photos) {
    if (!p) continue
    blobKeys.push(p.blobKey)
    freedBytes += p.sizeBytes
  }
  return { photoIds: [...photoIds], blobKeys, logIds, freedBytes }
}

/** 执行图片清理：先删 Blob，再业务事务删 Photo 行 + 清空对应 Log 的引用 */
async function executePrune(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
  plan: PrunePlan,
): Promise<{ deletedPhotos: number; freedBytes: number }> {
  if (plan.photoIds.length === 0) return { deletedPhotos: 0, freedBytes: 0 }

  // 1) 先删 Blob（独立库）；失败则整体中止，业务记录不动
  await blobStore.deleteMany(plan.blobKeys)

  // 2) 业务事务：删 Photo 行 + 从 Log 移除引用
  await db.transaction('rw', [db.photos, db.logs], async () => {
    await db.photos.bulkDelete(plan.photoIds)
    if (plan.logIds.length > 0) {
      const affected = await db.logs.bulkGet(plan.logIds)
      const updates = affected
        .filter((l): l is NonNullable<typeof l> => l !== undefined)
        .map((l) => ({ ...l, photoIds: [], updatedAt: new Date().toISOString() }))
      await db.logs.bulkPut(updates)
    }
  })

  return { deletedPhotos: plan.photoIds.length, freedBytes: plan.freedBytes }
}

/** 仅保留近一年（365 天）图片，更早的图片删除，文字记录保留 */
export async function pruneImagesOlderThanOneYear(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
  now: Date = new Date(),
): Promise<{ deletedPhotos: number; freedBytes: number }> {
  const cutoff = new Date(now.getTime() - 365 * DAY_MS)
  const plan = await buildOldImagePlan(db, cutoff.toISOString())
  return executePrune(db, blobStore, plan)
}

/** 清空全部图片但保留文字记录与图鉴状态 */
export async function clearAllImages(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
): Promise<{ deletedPhotos: number; freedBytes: number }> {
  const allPhotos = await db.photos.toArray()
  if (allPhotos.length === 0) return { deletedPhotos: 0, freedBytes: 0 }

  const logIds = new Set<string>()
  for (const p of allPhotos) {
    if (p.refType === 'log') logIds.add(p.refId)
  }
  const plan: PrunePlan = {
    photoIds: allPhotos.map((p) => p.id),
    blobKeys: allPhotos.map((p) => p.blobKey),
    logIds: [...logIds],
    freedBytes: allPhotos.reduce((s, p) => s + p.sizeBytes, 0),
  }
  return executePrune(db, blobStore, plan)
}
