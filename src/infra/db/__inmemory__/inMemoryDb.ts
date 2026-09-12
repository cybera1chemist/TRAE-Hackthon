/**
 * 内存假实现（分工文档 §2.3 冻结契约 / §3 交付物）。
 * 用途：Agent-1 Dexie 版本落地前，批次 3 Agent（3/4/5/6）据此开发与自测“假打卡”全链路；
 *       E2E（jsdom / 无 IDB 环境）与单测同样可用。
 * 语义对齐 TDD §3.3/§4.2：addMany 为“伪事务”——失败时整体回滚（可注入故障）。
 * 生命周期：仅内存，刷新即失；不要用于真实数据。
 */
import type {
  BlobStore,
  AddLogPhotoInput,
  DishInput,
  DishRepo,
  LogRepo,
  MenuScanRepo,
  PhotoInput,
  PhotoRepo,
  RestaurantInput,
  RestaurantRepo,
  Repositories,
  UserProfileRepo,
} from '@/infra/db/repositories'
import type {
  BBox,
  Dish,
  ID,
  Log,
  MenuScan,
  OcrItem,
  Photo,
  PhotoRefType,
  Restaurant,
  UserProfile,
} from '@/domain/entities'
import { isAvoidLog } from '@/domain/entities/common'

const now = () => new Date().toISOString()
const rand = () => Math.random().toString(36).slice(2, 10)

let seq = 0
const genId = (prefix: string) => `${prefix}_${(++seq).toString(36)}${rand()}`

/** 故障注入：下一次 addMany 中途抛错（供回滚测试） */
export interface InMemoryDbOptions {
  failNextAddMany?: boolean
}

export class InMemoryDb {
  restaurants = new Map<ID, Restaurant>()
  dishes = new Map<ID, Dish>()
  logs = new Map<ID, Log>()
  photos = new Map<ID, Photo>()
  menuScans = new Map<ID, MenuScan>()
  ocrItems = new Map<ID, OcrItem>()
  profiles = new Map<ID, UserProfile>()
  blobs = new Map<string, Blob>()
  options: InMemoryDbOptions = {}

  reset(): void {
    this.restaurants.clear()
    this.dishes.clear()
    this.logs.clear()
    this.photos.clear()
    this.menuScans.clear()
    this.ocrItems.clear()
    this.profiles.clear()
    this.blobs.clear()
    this.options = {}
  }

  /** 预置夹具（E2E/演示用：川香小馆 + 已解锁水煮牛肉） */
  seed(): { restaurantId: ID; dishId: ID } {
    const r = createRestaurant(this, { name: '川香小馆（大学城店）', city: '广州' })
    const d = createDish(this, r.id, {
      name: '水煮牛肉',
      nameSource: 'ocr',
      section: '招牌菜',
      prices: [{ spec: '例', price: 58 }],
    })
    return { restaurantId: r.id, dishId: d.id }
  }
}

// ── 派生字段重算（对齐 TDD §4.2 recomputeDerived / §3.3 解锁与避雷判定） ─────

function recomputeDish(db: InMemoryDb, dishId: ID): void {
  const dish = db.dishes.get(dishId)
  if (!dish) return
  const logs = [...db.logs.values()]
    .filter((l) => l.dishId === dishId)
    .sort((a, b) => a.ateAt.localeCompare(b.ateAt))

  const rated = logs.filter((l) => l.rating !== null)
  const avg =
    rated.length === 0 ? null : rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length
  const latest = logs[logs.length - 1]
  const derivedAvoid = logs.some((l) => isAvoidLog(l.rating, l.manualAvoid))
  const hasLogs = logs.length > 0

  db.dishes.set(dishId, {
    ...dish,
    // 解锁 = 存在 ≥1 条 Log；删光回 locked（T1-05 验收）
    status: hasLogs ? 'unlocked' : 'locked',
    unlockedAt: hasLogs ? (dish.unlockedAt ?? logs[0]?.createdAt) : undefined,
    firstLogId: hasLogs ? (dish.firstLogId ?? logs[0]?.id) : undefined,
    // 无 Log 时保留用户手动标记的 isAvoid；有 Log 以聚合结果为准（撤销避雷重算全部 Log）
    isAvoid: hasLogs ? derivedAvoid : dish.isAvoid,
    stats: {
      logCount: logs.length,
      avgRating: avg === null ? null : Math.round(avg * 10) / 10,
      latestRating: latest?.rating ?? null,
      latestLogAt: latest?.ateAt,
    },
    updatedAt: now(),
  })
  recomputeRestaurant(db, dish.restaurantId)
}

function recomputeRestaurant(db: InMemoryDb, rid: ID): void {
  const r = db.restaurants.get(rid)
  if (!r) return
  const dishes = [...db.dishes.values()].filter((d) => d.restaurantId === rid)
  const logs = [...db.logs.values()].filter((l) => l.restaurantId === rid)
  const rated = logs.filter((l) => l.rating !== null)
  db.restaurants.set(rid, {
    ...r,
    dishIds: dishes.map((d) => d.id),
    stats: {
      dishTotal: dishes.length,
      unlockedCount: dishes.filter((d) => d.status === 'unlocked').length,
      avoidCount: dishes.filter((d) => d.isAvoid).length,
      avgRating:
        rated.length === 0
          ? null
          : Math.round((rated.reduce((s, l) => s + (l.rating ?? 0), 0) / rated.length) * 10) / 10,
      logCount: logs.length,
    },
    updatedAt: now(),
  })
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────

function createRestaurant(db: InMemoryDb, input: RestaurantInput): Restaurant {
  const r: Restaurant = {
    id: genId('rst'),
    name: input.name,
    aliases: input.aliases ?? [],
    city: input.city,
    district: input.district,
    address: input.address,
    coverPhotoId: input.coverPhotoId,
    dishIds: [],
    stats: { dishTotal: 0, unlockedCount: 0, avoidCount: 0, avgRating: null, logCount: 0 },
    createdAt: now(),
    updatedAt: now(),
    syncState: 'local_only',
  }
  db.restaurants.set(r.id, r)
  return r
}

function createDish(db: InMemoryDb, rid: ID, input: DishInput): Dish {
  const d: Dish = {
    id: genId('dsh'),
    restaurantId: rid,
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
    createdAt: now(),
    updatedAt: now(),
  }
  db.dishes.set(d.id, d)
  recomputeRestaurant(db, rid)
  return d
}

function attachPhotos(
  db: InMemoryDb,
  refType: PhotoRefType,
  refId: ID,
  inputs: AddLogPhotoInput[],
): ID[] {
  return inputs.map((p) => {
    const ph: Photo = {
      id: p.id ?? genId('pho'),
      refType,
      refId,
      blobKey: p.blobKey,
      width: p.width,
      height: p.height,
      sizeBytes: p.sizeBytes,
      isCover: p.isCover ?? false,
      createdAt: now(),
    }
    db.photos.set(ph.id, ph)
    return ph.id
  })
}

// ── Repositories ─────────────────────────────────────────────────────────────

function makeRestaurantRepo(db: InMemoryDb): RestaurantRepo {
  return {
    async create(input) {
      return createRestaurant(db, input)
    },
    async get(id) {
      return db.restaurants.get(id)
    },
    async search(keyword, limit = 10) {
      const k = keyword.trim().toLowerCase()
      if (!k) return []
      return [...db.restaurants.values()]
        .filter(
          (r) =>
            r.name.toLowerCase().includes(k) || r.aliases.some((a) => a.toLowerCase().includes(k)),
        )
        .slice(0, limit)
    },
    async update(id, patch) {
      const r = db.restaurants.get(id)
      if (!r) throw new Error(`restaurant not found: ${id}`)
      db.restaurants.set(id, { ...r, ...patch, id: r.id, updatedAt: now() })
    },
    async remove(id, opts) {
      const dishes = [...db.dishes.values()].filter((d) => d.restaurantId === id)
      for (const d of dishes) {
        if (!opts.keepLogs) {
          for (const l of [...db.logs.values()].filter((l) => l.dishId === d.id)) {
            for (const p of l.photoIds) db.photos.delete(p)
            db.logs.delete(l.id)
          }
        }
        db.dishes.delete(d.id)
      }
      db.restaurants.delete(id)
    },
  }
}

function makeDishRepo(db: InMemoryDb): DishRepo {
  return {
    async listByRestaurant(rid) {
      return [...db.dishes.values()]
        .filter((d) => d.restaurantId === rid)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async listByFilter(q) {
      let list = [...db.dishes.values()]
      if (q.ids) list = list.filter((d) => q.ids!.includes(d.id))
      if (q.restaurantId) list = list.filter((d) => d.restaurantId === q.restaurantId)
      if (q.status) list = list.filter((d) => d.status === q.status)
      if (q.isAvoid !== undefined) list = list.filter((d) => d.isAvoid === q.isAvoid)
      if (q.cuisine) list = list.filter((d) => d.tags.some((t) => t.value === q.cuisine))
      if (q.tag)
        list = list.filter((d) =>
          d.tags.some((t) => t.dim === q.tag!.dim && t.value === q.tag!.value),
        )
      if (q.query) {
        const k = q.query.toLowerCase()
        list = list.filter(
          (d) =>
            d.name.toLowerCase().includes(k) || d.aliases.some((a) => a.toLowerCase().includes(k)),
        )
      }
      const dir = q.sortOrder === 'asc' ? 1 : -1
      const sortBy = q.sortBy ?? 'updatedAt'
      list.sort((a, b) => {
        if (sortBy === 'name') return dir * a.name.localeCompare(b.name, 'zh-Hans-CN')
        if (sortBy === 'rating')
          return dir * ((a.stats.avgRating ?? -1) - (b.stats.avgRating ?? -1))
        if (sortBy === 'unlockedAt')
          return dir * (a.unlockedAt ?? '').localeCompare(b.unlockedAt ?? '')
        return dir * a.updatedAt.localeCompare(b.updatedAt)
      })
      const offset = q.offset ?? 0
      return list.slice(offset, q.limit !== undefined ? offset + q.limit : undefined)
    },
    async create(rid, input) {
      if (!db.restaurants.has(rid)) throw new Error(`restaurant not found: ${rid}`)
      return createDish(db, rid, input)
    },
    async get(id) {
      return db.dishes.get(id)
    },
    async upsertFromOcr(rid, items) {
      const created: ID[] = []
      const linked: ID[] = []
      for (const item of items) {
        // 人工保护：无用户决议不允许入库（PRD §7.7）
        if (!item.userDecision) continue
        if (item.matchType === 'exact' && item.targetDishId) {
          const d = db.dishes.get(item.targetDishId)
          if (d) {
            linked.push(d.id)
            continue
          }
        }
        const d = createDish(db, rid, {
          name: item.name,
          nameSource: item.nameSource,
          aiSuggestedName: item.aiSuggestedName,
          section: item.section,
          prices: item.price != null ? [{ price: item.price }] : [],
        })
        created.push(d.id)
      }
      return { created, linked }
    },
    async setAvoid(id, avoid) {
      const d = db.dishes.get(id)
      if (!d) throw new Error(`dish not found: ${id}`)
      db.dishes.set(id, { ...d, isAvoid: avoid, updatedAt: now() })
      recomputeRestaurant(db, d.restaurantId)
    },
    async update(id, patch) {
      const d = db.dishes.get(id)
      if (!d) throw new Error(`dish not found: ${id}`)
      // nameSource==='user' 的人工菜名保护（TDD §6）：AI/OCR 不得直接覆盖 name
      if (
        d.nameSource === 'user' &&
        patch.name &&
        patch.nameSource &&
        patch.nameSource !== 'user'
      ) {
        db.dishes.set(id, {
          ...d,
          ...patch,
          name: d.name,
          nameSource: d.nameSource,
          aiSuggestedName: patch.name,
          id: d.id,
          updatedAt: now(),
        })
        return
      }
      db.dishes.set(id, { ...d, ...patch, id: d.id, updatedAt: now() })
    },
    async recomputeDerived(dishId) {
      recomputeDish(db, dishId)
    },
  }
}

function makeLogRepo(db: InMemoryDb): LogRepo {
  return {
    async addMany(inputs) {
      // 伪事务：先在暂存区写入，任一步失败则整体回滚（TDD §3.3 原子性）
      const snapshot = {
        logs: new Map(db.logs),
        photos: new Map(db.photos),
        dishes: new Map(db.dishes),
        restaurants: new Map(db.restaurants),
      }
      try {
        if (db.options.failNextAddMany) {
          db.options.failNextAddMany = false
          throw new Error('[InMemoryDb] injected addMany failure')
        }
        const out: Log[] = []
        for (const input of inputs) {
          const dish = db.dishes.get(input.dishId)
          if (!dish) throw new Error(`dish not found: ${input.dishId}`)
          const log: Log = {
            id: genId('log'),
            dishId: input.dishId,
            restaurantId: input.restaurantId,
            canonicalDishId: dish.canonicalDishId,
            rating: input.rating,
            manualAvoid: input.manualAvoid,
            comment: input.comment ?? '',
            price: input.price ?? null,
            scene: input.scene,
            ateAt: input.ateAt,
            photoIds: [],
            aiSnapshot: input.aiSnapshot,
            tagExtractionState: 'pending',
            createdAt: now(),
            updatedAt: now(),
          }
          db.logs.set(log.id, log)
          // 图片行挂在 Log 下（PRD §7.6：Photo.refType='log', refId=log.id）
          log.photoIds = attachPhotos(db, 'log', log.id, input.photos ?? [])
          out.push(log)
          recomputeDish(db, input.dishId)
        }
        return out
      } catch (e) {
        db.logs = snapshot.logs
        db.photos = snapshot.photos
        db.dishes = snapshot.dishes
        db.restaurants = snapshot.restaurants
        throw e
      }
    },
    async listByDish(dishId) {
      return [...db.logs.values()]
        .filter((l) => l.dishId === dishId)
        .sort((a, b) => b.ateAt.localeCompare(a.ateAt))
    },
    async listAll(limit) {
      const list = [...db.logs.values()].sort((a, b) => b.ateAt.localeCompare(a.ateAt))
      return limit !== undefined ? list.slice(0, limit) : list
    },
    async remove(id) {
      const log = db.logs.get(id)
      if (!log) return
      db.logs.delete(id)
      for (const p of log.photoIds) db.photos.delete(p)
      recomputeDish(db, log.dishId)
    },
  }
}

function makePhotoRepo(db: InMemoryDb): PhotoRepo {
  return {
    async attach(meta: PhotoInput) {
      const p: Photo = {
        ...meta,
        id: meta.id ?? genId('pho'),
        isCover: meta.isCover ?? false,
        createdAt: now(),
      }
      db.photos.set(p.id, p)
      return p
    },
    async listByRef(refType, refId) {
      return [...db.photos.values()].filter((p) => p.refType === refType && p.refId === refId)
    },
    async get(id) {
      return db.photos.get(id)
    },
    async remove(id) {
      db.photos.delete(id)
    },
  }
}

function makeMenuScanRepo(db: InMemoryDb): MenuScanRepo {
  return {
    async create(input) {
      const s: MenuScan = {
        id: genId('scan'),
        restaurantId: input.restaurantId,
        sourceImageIds: input.sourceImageIds,
        status: 'pending',
        isIncremental: input.isIncremental,
        createdAt: now(),
      }
      db.menuScans.set(s.id, s)
      return s
    },
    async get(id) {
      return db.menuScans.get(id)
    },
    async listByRestaurant(rid) {
      return [...db.menuScans.values()]
        .filter((s) => s.restaurantId === rid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async update(id, patch) {
      const s = db.menuScans.get(id)
      if (!s) throw new Error(`menuScan not found: ${id}`)
      db.menuScans.set(id, { ...s, ...patch, id: s.id })
    },
    async addOcrItems(scanId, items) {
      const out: OcrItem[] = items.map((it) => {
        const o: OcrItem = {
          id: genId('ocr'),
          scanId,
          sourceImageId: it.sourceImageId,
          section: it.section,
          rawText: it.rawText,
          normalizedName: it.normalizedName,
          price: it.price,
          confidence: it.confidence,
          bbox: it.bbox,
          matchResult: it.matchResult,
          createdAt: now(),
        }
        db.ocrItems.set(o.id, o)
        return o
      })
      return out
    },
    async listOcrItems(scanId) {
      return [...db.ocrItems.values()]
        .filter((o) => o.scanId === scanId)
        .sort((a, b) => b.confidence - a.confidence)
    },
    async updateOcrItem(id, patch) {
      const o = db.ocrItems.get(id)
      if (!o) throw new Error(`ocrItem not found: ${id}`)
      db.ocrItems.set(id, { ...o, ...patch, id: o.id })
    },
  }
}

function makeUserProfileRepo(db: InMemoryDb): UserProfileRepo {
  return {
    async get() {
      return db.profiles.get('me')
    },
    async save(profile) {
      db.profiles.set('me', profile)
    },
  }
}

// ── BlobStore 假实现（Map 存 Blob，接口对齐分工 §3） ─────────────────────────

export function makeBlobStore(db: InMemoryDb): BlobStore {
  return {
    async put(key, blob) {
      const k = key.startsWith('idb://') ? key : `idb://blobs/${key}`
      db.blobs.set(k, blob)
      return k
    },
    async get(key) {
      return db.blobs.get(key)
    },
    async delete(key) {
      db.blobs.delete(key)
    },
    async usage() {
      let usage = 0
      for (const b of db.blobs.values()) usage += b.size
      return { usage, quota: 500 * 1024 * 1024 }
    },
  }
}

// ── 组装入口 ─────────────────────────────────────────────────────────────────

export function createInMemoryRepositories(db = new InMemoryDb()): {
  repos: Repositories
  blobStore: BlobStore
  db: InMemoryDb
} {
  const repos: Repositories = {
    restaurants: makeRestaurantRepo(db),
    dishes: makeDishRepo(db),
    logs: makeLogRepo(db),
    photos: makePhotoRepo(db),
    menuScans: makeMenuScanRepo(db),
    userProfile: makeUserProfileRepo(db),
  }
  return { repos, blobStore: makeBlobStore(db), db }
}

/** bbox 的 AI 元组口径 → 存储对象口径转换工具（TDD §5.2 ↔ PRD §7.7） */
export function bboxFromTuple(t: [number, number, number, number]): BBox {
  const [x1, y1, x2, y2] = t
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
