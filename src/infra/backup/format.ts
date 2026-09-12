/**
 * JSON 备份格式与纯函数（T5-05，TDD §4.4）
 *
 * 导出包：
 *   { app:'fooddex', schemaVersion, exportedAt, photos:'base64'|'none', data:{...核心表} }
 * 图片随包时按每卷 ≤50MB 切分为独立 photos 卷文件（文字数据始终在主包）。
 *
 * 导入冲突与 OCR 同构：同店同菜用 matchDish 做 exact/fuzzy/new 检测；
 * fuzzy 必须用户决议（merge=并入已有菜 / separate=作为新菜），无决议不入库。
 * 高版本备份导入低版本客户端一律拒绝。
 */
import type {
  Dish,
  Log,
  MenuScan,
  OcrItem,
  Photo,
  Restaurant,
  UserProfile,
} from '@/domain/entities'
import { matchDish, type MatchType } from '@/domain/services/matcher'
import { SCHEMA_VERSION } from '@/infra/db/schema'
import type { TagVocabRecord } from '@/infra/db/schema'

export const BACKUP_APP = 'fooddex' as const
export const MAX_VOLUME_BYTES = 50 * 1024 * 1024

export interface BackupData {
  userProfile: UserProfile[]
  restaurants: Restaurant[]
  dishes: Dish[]
  logs: Log[]
  photos: Photo[]
  tagVocab: TagVocabRecord[]
  menuScans: MenuScan[]
  ocrItems: OcrItem[]
}

export interface PhotoBlobEntry {
  /** Photo.blobKey 原样存储，导入时据此挂回 */
  key: string
  mediaType: string
  /** 去掉 dataURL 前缀的 base64 */
  dataBase64: string
}

export interface BackupPackage {
  app: typeof BACKUP_APP
  schemaVersion: number
  exportedAt: string
  photos: 'base64' | 'none'
  data: BackupData
}

/** 图片分卷文件（每卷 ≤50MB） */
export interface PhotoVolume {
  app: typeof BACKUP_APP
  schemaVersion: number
  exportedAt: string
  part: 'photos'
  index: number
  total: number
  blobs: PhotoBlobEntry[]
}

// ── 校验与分卷 ────────────────────────────────────────────────────────────────

export function validateBackupPackage(pkg: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof pkg !== 'object' || pkg === null) return { ok: false, reason: '备份内容不是有效对象' }
  const p = pkg as Partial<BackupPackage>
  if (p.app !== BACKUP_APP) return { ok: false, reason: '非 FoodDex 备份文件' }
  if (typeof p.schemaVersion !== 'number')
    return { ok: false, reason: '缺少 schemaVersion，文件可能已损坏' }
  if (p.schemaVersion > SCHEMA_VERSION)
    return {
      ok: false,
      reason: `备份版本 v${p.schemaVersion} 高于当前 v${SCHEMA_VERSION}，请先升级应用`,
    }
  if (p.schemaVersion < 1) return { ok: false, reason: 'schemaVersion 无效' }
  if (typeof p.data !== 'object' || p.data === null)
    return { ok: false, reason: '备份缺少 data 段' }
  return { ok: true }
}

/** 按 base64 字节规模估算图片卷数（3/4 为 base64 膨胀系数的逆估计） */
export function suggestVolumeCount(totalBase64Length: number, maxBytes = MAX_VOLUME_BYTES): number {
  if (totalBase64Length <= 0) return 0
  return Math.max(1, Math.ceil(totalBase64Length / maxBytes))
}

// ── 冲突预览（纯函数，不触碰 DB） ─────────────────────────────────────────────

export type RestaurantAction = 'merge' | 'create'
export type DishDecision = 'merge' | 'separate'

export interface RestaurantPreview {
  incomingId: string
  name: string
  action: RestaurantAction
  existingId?: string
}

export interface DishConflict {
  incomingId: string
  incomingName: string
  incomingRestaurantId: string
  type: MatchType
  existingDishId?: string
  score: number
  /** fuzzy 时必须由用户决定 merge / separate */
  userDecisionRequired: boolean
}

export interface ImportPreview {
  restaurants: RestaurantPreview[]
  dishes: DishConflict[]
  /** 需要用户决议的 fuzzy 项数量 */
  requiresDecision: number
  stats: {
    restaurantsToCreate: number
    dishesToCreate: number
    dishesToMerge: number
    logs: number
    photos: number
  }
}

/** 同名（trim + 小写）店铺匹配；找不到则新建 */
export function previewRestaurants(
  incoming: Restaurant[],
  existing: Restaurant[],
): RestaurantPreview[] {
  const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r.id]))
  return incoming.map((r) => {
    const existingId = byName.get(r.name.trim().toLowerCase())
    return existingId
      ? { incomingId: r.id, name: r.name, action: 'merge' as const, existingId }
      : { incomingId: r.id, name: r.name, action: 'create' as const }
  })
}

/**
 * 生成导入预览：店铺同名合并/新建；菜品在映射到的同店现有菜中匹配。
 */
export function previewImport(
  pkg: BackupPackage,
  existing: {
    restaurants: Restaurant[]
    dishes: Dish[]
  },
): ImportPreview {
  const data = pkg.data
  const restaurantPreviews = previewRestaurants(data.restaurants, existing.restaurants)
  const ridMap = new Map(restaurantPreviews.map((p) => [p.incomingId, p.existingId ?? null]))
  const existingByRestaurant = new Map<string, Dish[]>()
  for (const d of existing.dishes) {
    const list = existingByRestaurant.get(d.restaurantId) ?? []
    list.push(d)
    existingByRestaurant.set(d.restaurantId, list)
  }

  const conflicts: DishConflict[] = data.dishes.map((d) => {
    // ridMap: incomingRestaurantId → existingId（merge）或 null（create）
    const targetRid = ridMap.get(d.restaurantId)
    if (targetRid == null) {
      // 店铺为新建（或包内缺失该店铺，按新建防御处理）：店内无冲突
      return {
        incomingId: d.id,
        incomingName: d.name,
        incomingRestaurantId: d.restaurantId,
        type: 'new',
        score: 0,
        userDecisionRequired: false,
      }
    }
    const candidates = existingByRestaurant.get(targetRid) ?? []
    const m = matchDish({ name: d.name, aliases: d.aliases }, candidates)
    return {
      incomingId: d.id,
      incomingName: d.name,
      incomingRestaurantId: d.restaurantId,
      type: m.type,
      existingDishId: m.dishId,
      score: m.score,
      userDecisionRequired: m.userDecisionRequired,
    }
  })

  const requiresDecision = conflicts.filter((c) => c.userDecisionRequired).length
  return {
    restaurants: restaurantPreviews,
    dishes: conflicts,
    requiresDecision,
    stats: {
      restaurantsToCreate: restaurantPreviews.filter((r) => r.action === 'create').length,
      dishesToCreate: conflicts.filter((c) => c.type === 'new').length,
      dishesToMerge: conflicts.filter((c) => c.type === 'exact').length,
      logs: data.logs.length,
      photos: data.photos.length,
    },
  }
}
