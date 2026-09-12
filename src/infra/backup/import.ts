/**
 * 备份导入（T5-05，TDD §4.4）—— Agent-1
 *
 * 流程：版本校验 → previewImport 冲突预览 → 用户对 fuzzy 决议 →
 *   构建 oldId→newId 映射（merge 复用现有 id，create 重新发号）→
 *   单事务批量提交（无决议的 fuzzy 及其 Log/Photo 跳过）→
 *   写入图片卷 Blob → recomputeAll 自愈全部派生字段。
 */
import type { FoodDexDatabase } from '@/infra/db/database'
import type { IdbBlobStore } from '@/infra/blob/IdbBlobStore'
import type { Dish } from '@/domain/entities'
import { genId } from '@/domain/factories'
import { recomputeAll } from '@/infra/db/maintenance'
import { base64ToBlob } from './export'
import {
  previewImport,
  validateBackupPackage,
  type BackupPackage,
  type DishConflict,
  type DishDecision,
  type PhotoVolume,
} from './format'

export interface ApplyBackupOptions {
  /** fuzzy 项的用户决议：merge=并入 existingDishId，separate=作为新菜 */
  decisions?: Record<string, DishDecision>
  /** 图片卷（主包 photos='base64' 时由调用方按顺序提供） */
  photoVolumes?: PhotoVolume[]
}

export interface ApplyBackupResult {
  imported: {
    restaurants: number
    dishes: number
    logs: number
    photos: number
    menuScans: number
    blobs: number
  }
  /** 因缺少 fuzzy 决议而跳过的菜及其 Log/Photo 数量 */
  skippedDishes: number
}

class BackupValidationError extends Error {}

export async function applyBackup(
  db: FoodDexDatabase,
  blobStore: IdbBlobStore,
  pkg: BackupPackage,
  options: ApplyBackupOptions = {},
): Promise<ApplyBackupResult> {
  const validation = validateBackupPackage(pkg)
  if (!validation.ok) throw new BackupValidationError(validation.reason)

  const data = pkg.data
  const existing = {
    restaurants: await db.restaurants.toArray(),
    dishes: await db.dishes.toArray(),
  }
  const preview = previewImport(pkg, existing)

  // ── 构建 ID 映射 ─────────────────────────────────────────────────────────
  const ridMap = new Map<string, string>()
  for (const r of preview.restaurants) {
    ridMap.set(r.incomingId, r.action === 'merge' && r.existingId ? r.existingId : genId('rst'))
  }
  // 防御：包内 Dish 引用了不在 data.restaurants 中的店铺
  for (const d of data.dishes) {
    if (!ridMap.has(d.restaurantId)) ridMap.set(d.restaurantId, genId('rst'))
  }

  const decisions = options.decisions ?? {}
  const skippedDishIds = new Set<string>()
  const dishIdMap = new Map<string, string>()
  for (const c of preview.dishes) {
    dishIdMap.set(c.incomingId, resolveDishId(c, decisions[c.incomingId], skippedDishIds))
  }

  // ── 业务事务：核心表批量导入 ──────────────────────────────────────────────
  const result: ApplyBackupResult['imported'] = {
    restaurants: 0,
    dishes: 0,
    logs: 0,
    photos: 0,
    menuScans: 0,
    blobs: 0,
  }

  await db.transaction(
    'rw',
    [
      db.userProfile,
      db.restaurants,
      db.dishes,
      db.logs,
      db.photos,
      db.menuScans,
      db.ocrItems,
      db.tagVocab,
    ],
    async () => {
      // restaurants（仅新建的）
      const newRestaurants = data.restaurants
        .filter((r) => preview.restaurants.find((p) => p.incomingId === r.id)?.action === 'create')
        .map((r) => ({ ...r, id: ridMap.get(r.id)! }))
      if (newRestaurants.length > 0) await db.restaurants.bulkPut(newRestaurants)
      result.restaurants = newRestaurants.length

      // dishes：跳过无决议 fuzzy 与 merge（exact/fuzzy-merge 复用现有菜，不覆盖菜本体）
      // 注意：导入菜必须剥离全部派生字段（status/isAvoid/stats/firstLogId/unlockedAt），
      // 否则源库的 firstLogId 会被 deriveUnlock 当既有值保留，指向不存在的源 Log；
      // 事务后由 recomputeAll 依据导入 Log 统一自愈。
      const newDishes: Dish[] = []
      for (const d of data.dishes) {
        if (skippedDishIds.has(d.id)) continue
        const conflict = preview.dishes.find((c) => c.incomingId === d.id)
        const isMerged =
          conflict?.type === 'exact' || (conflict?.type === 'fuzzy' && decisions[d.id] === 'merge')
        if (isMerged) continue
        const {
          status: _status,
          isAvoid: _isAvoid,
          stats: _stats,
          firstLogId: _firstLogId,
          unlockedAt: _unlockedAt,
          ...rest
        } = d
        newDishes.push({
          ...rest,
          id: dishIdMap.get(d.id)!,
          restaurantId: ridMap.get(d.restaurantId) ?? d.restaurantId,
          status: 'locked',
          isAvoid: false,
          stats: { logCount: 0, avgRating: null, latestRating: null },
        })
      }
      if (newDishes.length > 0) await db.dishes.bulkPut(newDishes)
      result.dishes = newDishes.length

      // logs：重映射 dish/restaurant；跳过无决议菜的 Log；图片 id 全部重新发号
      const photoTarget = new Map<string, { photoId: string; logId: string }>()
      const newLogs = data.logs
        .filter((l) => !skippedDishIds.has(l.dishId))
        .map((l) => {
          const newLogId = genId('log')
          const newPhotoIds = l.photoIds.map((oldPid) => {
            const newPid = genId('pho')
            photoTarget.set(oldPid, { photoId: newPid, logId: newLogId })
            return newPid
          })
          return {
            ...l,
            id: newLogId,
            dishId: dishIdMap.get(l.dishId) ?? l.dishId,
            restaurantId: ridMap.get(l.restaurantId) ?? l.restaurantId,
            photoIds: newPhotoIds,
          }
        })
      if (newLogs.length > 0) await db.logs.bulkPut(newLogs)
      result.logs = newLogs.length

      // photos：
      //  - log 图：id 与 refId 完整重映射；
      //  - dish 图：id 重新发号，refId 走菜品映射；
      //  - scan 图：v1 跳过（OCR 源图，恢复价值低且引用链复杂）。
      const newPhotos = []
      for (const p of data.photos) {
        if (p.refType === 'log') {
          const target = photoTarget.get(p.id)
          if (!target) continue
          newPhotos.push({ ...p, id: target.photoId, refId: target.logId })
        } else if (p.refType === 'dish') {
          const newDishId = dishIdMap.get(p.refId)
          if (!newDishId) continue
          newPhotos.push({ ...p, id: genId('pho'), refId: newDishId })
        }
      }
      if (newPhotos.length > 0) await db.photos.bulkPut(newPhotos)
      result.photos = newPhotos.length

      // menuScans / ocrItems（重映射 restaurantId/scanId，作为归档恢复）
      const scanIdMap = new Map<string, string>()
      for (const s of data.menuScans) scanIdMap.set(s.id, genId('scan'))
      const newScans = data.menuScans.map((s) => ({
        ...s,
        id: scanIdMap.get(s.id)!,
        restaurantId: ridMap.get(s.restaurantId) ?? s.restaurantId,
      }))
      if (newScans.length > 0) await db.menuScans.bulkPut(newScans)
      result.menuScans = newScans.length

      const newOcrItems = data.ocrItems.map((o) => ({
        ...o,
        id: genId('ocr'),
        scanId: scanIdMap.get(o.scanId) ?? o.scanId,
      }))
      if (newOcrItems.length > 0) await db.ocrItems.bulkPut(newOcrItems)

      if (data.tagVocab.length > 0) await db.tagVocab.bulkPut(data.tagVocab)
      if (data.userProfile.length > 0) await db.userProfile.bulkPut(data.userProfile)
    },
  )

  // ── 图片卷写入独立 Blob 库（业务事务外） ─────────────────────────────────
  let blobCount = 0
  for (const volume of options.photoVolumes ?? []) {
    for (const entry of volume.blobs) {
      await blobStore.put(entry.key, base64ToBlob(entry.dataBase64, entry.mediaType))
      blobCount++
    }
  }

  // ── 派生字段自愈（stats/status/isAvoid 与导入 Log 完全一致） ───────────────
  await recomputeAll(db)

  return { imported: { ...result, blobs: blobCount }, skippedDishes: skippedDishIds.size }
}

function resolveDishId(
  conflict: DishConflict,
  decision: DishDecision | undefined,
  skipped: Set<string>,
): string {
  if (conflict.type === 'exact' && conflict.existingDishId) return conflict.existingDishId
  if (conflict.type === 'fuzzy') {
    if (decision === 'merge' && conflict.existingDishId) return conflict.existingDishId
    if (decision === 'separate') return genId('dsh')
    skipped.add(conflict.incomingId)
    return conflict.existingDishId ?? genId('dsh')
  }
  return genId('dsh')
}
