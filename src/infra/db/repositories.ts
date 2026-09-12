/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 冻结契约（分工文档 §2.3）：Repository 接口签名。自 Agent-0 交付后
 * 【只允许追加新接口/新方法，不允许改既有签名】；改动须在 PR 描述 @ 受影响 Agent。
 * 依据：TDD §4.2（RestaurantRepo/DishRepo/LogRepo 为原文）+ §3.3 打卡事务。
 * Owner：Agent-0 初版 → Agent-1（data）实现 Dexie 版本（src/infra/db/）。
 * 业务层（workflows/pages）只允许依赖本文件接口，禁止直接依赖 Dexie。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { AISnapshot, Log } from '@/domain/entities/log'
import type {
  BBox,
  Dish,
  DishNameSource,
  DishPrice,
  DishStatus,
  ID,
  MenuScan,
  OcrItem,
  OcrMatchType,
  Photo,
  PhotoRefType,
  Restaurant,
  ResolvedOcrItem,
  TagDim,
  UserProfile,
} from '@/domain/entities'

// ── 输入类型 ─────────────────────────────────────────────────────────────────

export interface RestaurantInput {
  name: string
  aliases?: string[]
  city?: string
  district?: string
  address?: string
  coverPhotoId?: ID
}

export interface DishInput {
  name: string
  nameSource: DishNameSource
  aiSuggestedName?: string
  canonicalDishId?: ID
  section?: string
  aliases?: string[]
  prices?: DishPrice[]
}

/** 图鉴视图/筛选/排序条件（PRD §5.3.2，筛选条件入 URL query） */
export interface DexFilter {
  restaurantId?: ID
  status?: DishStatus
  isAvoid?: boolean
  query?: string
  tag?: { dim: TagDim; value: string }
  cuisine?: string
  ids?: ID[]
  limit?: number
  offset?: number
  sortBy?: 'updatedAt' | 'unlockedAt' | 'rating' | 'name'
  sortOrder?: 'asc' | 'desc'
}

/** 事务内一并写入的图片元信息（Blob 由 BlobStore 事先 put，此处只登记） */
export interface AddLogPhotoInput {
  id?: ID
  blobKey: string
  width: number
  height: number
  sizeBytes: number
  isCover?: boolean
}

/** 打卡写入（createLogWorkflow → LogRepo.addMany 事务入口，TDD §3.3） */
export interface AddLogInput {
  dishId: ID
  restaurantId: ID
  rating: number | null
  manualAvoid: boolean
  comment?: string
  price?: number | null
  scene?: string
  ateAt: string
  photos?: AddLogPhotoInput[]
  aiSnapshot?: AISnapshot
}

// ── Repository 接口（TDD §4.2 原文 + 追加方法） ──────────────────────────────

export interface RestaurantRepo {
  create(input: RestaurantInput): Promise<Restaurant>
  get(id: string): Promise<Restaurant | undefined>
  /** 名称/别名模糊搜索（打卡页店铺联想，PRD EC-CAP） */
  search(keyword: string, limit?: number): Promise<Restaurant[]>
  update(id: string, patch: Partial<Restaurant>): Promise<void>
  /** keepLogs: 是否保留打卡记录（删除店铺的确认语义，PRD §5.5） */
  remove(id: string, opts: { keepLogs?: boolean }): Promise<void>
}

export interface DishRepo {
  listByRestaurant(rid: string): Promise<Dish[]>
  listByFilter(q: DexFilter): Promise<Dish[]>
  /** 新建菜品（手动打卡“手添”路径） */
  create(rid: string, input: DishInput): Promise<Dish>
  get(id: string): Promise<Dish | undefined>
  /** OCR 决议提升为菜品：exact 关联 / fuzzy 合并 / new 建灰菜（TDD §3.4） */
  upsertFromOcr(rid: string, items: ResolvedOcrItem[]): Promise<{ created: ID[]; linked: ID[] }>
  setAvoid(id: string, avoid: boolean): Promise<void>
  update(id: string, patch: Partial<Omit<Dish, 'id' | 'createdAt'>>): Promise<void>
  /** 由 logs 重算 status/isAvoid/stats 派生字段（TDD §4.2） */
  recomputeDerived(dishId: string): Promise<void>
}

export interface LogRepo {
  /** 打卡事务入口：Restaurant/Dish/Log/Photo 同事务，失败整体回滚（TDD §3.3） */
  addMany(input: AddLogInput[]): Promise<Log[]>
  listByDish(dishId: string): Promise<Log[]>
  /** 全量日志（首页时间线按 ateAt 倒序）—— v1 追加方法 */
  listAll(limit?: number): Promise<Log[]>
  /** 删除后须触发 recomputeDerived（TDD §4.2） */
  remove(id: string): Promise<void>
  // ── v1.1 契约追加（append-only，T2-05 标签回填依赖；@Agent-0/Agent-1 知悉）──
  /** 按 ID 读取单条 Log（AsyncQueue extractTags 处理器定位任务目标） */
  get(id: string): Promise<Log | undefined>
  /**
   * 受控字段更新：仅限 tagExtractionState 等非派生字段（标签回填 markDone/markFailed）。
   * 禁止绕过事务直接改 photoIds 等关联字段；派生字段一律走 recomputeDerived。
   */
  update(id: string, patch: Partial<Omit<Log, 'id' | 'createdAt'>>): Promise<void>
}

// ── 追加接口（批次 3 所需，v1 范围内） ────────────────────────────────────────

export interface PhotoInput {
  id?: ID
  refType: PhotoRefType
  refId: ID
  blobKey: string
  width: number
  height: number
  sizeBytes: number
  isCover?: boolean
}

export interface PhotoRepo {
  attach(meta: PhotoInput): Promise<Photo>
  listByRef(refType: PhotoRefType, refId: ID): Promise<Photo[]>
  get(id: string): Promise<Photo | undefined>
  remove(id: string): Promise<void>
}

export interface MenuScanRepo {
  create(input: {
    restaurantId: ID
    sourceImageIds: ID[]
    isIncremental: boolean
  }): Promise<MenuScan>
  get(id: string): Promise<MenuScan | undefined>
  listByRestaurant(rid: string): Promise<MenuScan[]>
  update(id: string, patch: Partial<Omit<MenuScan, 'id' | 'createdAt'>>): Promise<void>
  /** 批量登记 OCR 候选（bbox 转换为 {x,y,w,h} 存储口径） */
  addOcrItems(
    scanId: string,
    items: Array<{
      sourceImageId?: ID
      section?: string
      rawText: string
      normalizedName: string
      price: number | null
      confidence: number
      bbox: BBox
      matchResult: { type: OcrMatchType; dishId?: ID; score?: number; candidates?: string[] }
    }>,
  ): Promise<OcrItem[]>
  listOcrItems(scanId: string): Promise<OcrItem[]>
  /** 记录用户决议（无决议不允许 upsertFromOcr） */
  updateOcrItem(id: string, patch: Partial<Omit<OcrItem, 'id' | 'createdAt'>>): Promise<void>
}

export interface UserProfileRepo {
  get(): Promise<UserProfile | undefined>
  save(profile: UserProfile): Promise<void>
}

/** 全量 Repository 聚合（注入根：main.tsx / workflows 构造时传入） */
export interface Repositories {
  restaurants: RestaurantRepo
  dishes: DishRepo
  logs: LogRepo
  photos: PhotoRepo
  menuScans: MenuScanRepo
  userProfile: UserProfileRepo
}

/**
 * BlobStore（分工文档 §3 交付物）：图片二进制独立存储。
 * put 返回实际存储 key；usage 返回浏览器配额（navigator.storage.estimate）。
 */
export interface BlobStore {
  put(key: string, blob: Blob): Promise<string>
  get(key: string): Promise<Blob | undefined>
  delete(key: string): Promise<void>
  usage(): Promise<{ usage: number; quota: number }>
}
