/**
 * 实体工厂函数（T1-02）—— 默认值与 ID 前缀约定的单一来源
 *
 * ID 前缀（common.ts 注释约定）：rst_/dsh_/log_/pho_/scan_/ocr_/can_/job_
 * Dexie 与 InMemory 两条仓储链路都必须经本工厂创建实体，保证默认值一致。
 */
import type {
  BBox,
  Dish,
  ID,
  Log,
  MenuScan,
  OcrItem,
  OcrMatchResult,
  Photo,
  Restaurant,
  UserProfile,
} from '@/domain/entities'
import type {
  AddLogInput,
  AddLogPhotoInput,
  DishInput,
  PhotoInput,
  RestaurantInput,
} from '@/infra/db/repositories'

export type IdPrefix = 'rst' | 'dsh' | 'log' | 'pho' | 'scan' | 'ocr' | 'can' | 'job'

let seq = 0

/** 时间有序 + 进程内自增 + 随机后缀，避免同毫秒碰撞 */
export function genId(prefix: IdPrefix): ID {
  seq = (seq + 1) % 0xffffff
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(4, '0')}${rand}`
}

const isoNow = (): string => new Date().toISOString()

// ── Restaurant ───────────────────────────────────────────────────────────────

export function createRestaurant(input: RestaurantInput, now: string = isoNow()): Restaurant {
  return {
    id: genId('rst'),
    name: input.name,
    aliases: input.aliases ?? [],
    city: input.city,
    district: input.district,
    address: input.address,
    coverPhotoId: input.coverPhotoId,
    dishIds: [],
    stats: { dishTotal: 0, unlockedCount: 0, avoidCount: 0, avgRating: null, logCount: 0 },
    createdAt: now,
    updatedAt: now,
    syncState: 'local_only',
  }
}

// ── Dish ─────────────────────────────────────────────────────────────────────

export function createDish(restaurantId: ID, input: DishInput, now: string = isoNow()): Dish {
  return {
    id: genId('dsh'),
    restaurantId,
    name: input.name,
    nameSource: input.nameSource,
    aiSuggestedName: input.aiSuggestedName,
    canonicalDishId: input.canonicalDishId,
    section: input.section,
    aliases: input.aliases ?? [],
    prices: input.prices ?? [],
    status: 'locked',
    isAvoid: false,
    stats: { logCount: 0, avgRating: null, latestRating: null },
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ── Log ──────────────────────────────────────────────────────────────────────

export function createLog(input: AddLogInput, now: string = isoNow()): Log {
  return {
    id: genId('log'),
    dishId: input.dishId,
    restaurantId: input.restaurantId,
    rating: input.rating,
    manualAvoid: input.manualAvoid,
    comment: input.comment ?? '',
    price: input.price ?? null,
    scene: input.scene,
    ateAt: input.ateAt,
    photoIds: [],
    aiSnapshot: input.aiSnapshot,
    tagExtractionState: 'pending',
    createdAt: now,
    updatedAt: now,
  }
}

// ── Photo ────────────────────────────────────────────────────────────────────

export function createPhoto(input: PhotoInput, now: string = isoNow()): Photo {
  return {
    id: input.id ?? genId('pho'),
    refType: input.refType,
    refId: input.refId,
    blobKey: input.blobKey,
    width: input.width,
    height: input.height,
    sizeBytes: input.sizeBytes,
    isCover: input.isCover ?? false,
    createdAt: now,
  }
}

/** 打卡事务内：图片挂到 Log 下（refType='log'） */
export function createLogPhoto(logId: ID, photo: AddLogPhotoInput, now: string = isoNow()): Photo {
  return createPhoto(
    {
      id: photo.id,
      refType: 'log',
      refId: logId,
      blobKey: photo.blobKey,
      width: photo.width,
      height: photo.height,
      sizeBytes: photo.sizeBytes,
      isCover: photo.isCover,
    },
    now,
  )
}

// ── MenuScan / OcrItem ───────────────────────────────────────────────────────

export interface NewMenuScanInput {
  restaurantId: ID
  sourceImageIds: ID[]
  isIncremental: boolean
}

export function createMenuScan(input: NewMenuScanInput, now: string = isoNow()): MenuScan {
  return {
    id: genId('scan'),
    restaurantId: input.restaurantId,
    sourceImageIds: input.sourceImageIds,
    status: 'pending',
    isIncremental: input.isIncremental,
    createdAt: now,
  }
}

export interface NewOcrItemInput {
  scanId: ID
  sourceImageId?: ID
  section?: string
  rawText: string
  normalizedName: string
  price: number | null
  confidence: number
  bbox: BBox
  matchResult: OcrMatchResult
}

export function createOcrItem(input: NewOcrItemInput, now: string = isoNow()): OcrItem {
  return {
    id: genId('ocr'),
    scanId: input.scanId,
    sourceImageId: input.sourceImageId,
    section: input.section,
    rawText: input.rawText,
    normalizedName: input.normalizedName,
    price: input.price,
    confidence: input.confidence,
    bbox: input.bbox,
    matchResult: input.matchResult,
    createdAt: now,
  }
}

// ── UserProfile ──────────────────────────────────────────────────────────────

export function createDefaultProfile(now: string = isoNow()): UserProfile {
  return {
    id: 'me',
    nickname: '美食探索者',
    preferences: {
      defaultCardTemplate: 'dex_rare',
      imageQuality: 'balanced',
      aiAssistedNaming: true,
    },
    stats: { totalLogs: 0, unlockedDishes: 0, restaurants: 0, streakDays: 0 },
    onboardedAt: now,
  }
}

/** 重新计算 UserProfile.stats 的快照值（设置页/写入后刷新） */
export function summarizeProfile(opts: {
  totalLogs: number
  unlockedDishes: number
  restaurants: number
  streakDays: number
}): UserProfile['stats'] {
  return {
    totalLogs: opts.totalLogs,
    unlockedDishes: opts.unlockedDishes,
    restaurants: opts.restaurants,
    streakDays: opts.streakDays,
  }
}
