/**
 * Dexie Repository 实现（T1-03，TDD §4.2 / §3.3）
 *
 * 关键语义（与 InMemory 版完全对齐，同套领域纯服务 + 工厂）：
 *  - addMany 为真正的 Dexie 多表原子事务，任一步失败整体回滚；
 *  - 派生字段（status/isAvoid/stats/firstLogId/unlockedAt）事务内重算；
 *  - nameSource='user' 的改名经 nameGuard 保护；
 *  - 业务层只依赖 repositories.ts 接口，不直接接触 Dexie。
 */
import type {
  AddLogInput,
  DishInput,
  DishRepo,
  LogRepo,
  MenuScanRepo,
  PhotoInput,
  PhotoRepo,
  Repositories,
  RestaurantRepo,
  UserProfileRepo,
} from '@/infra/db/repositories'
import type { ID, Log, Photo } from '@/domain/entities'
import {
  createDish,
  createLog,
  createMenuScan,
  createOcrItem,
  createPhoto,
  createLogPhoto,
  createRestaurant,
} from '@/domain/factories'
import { recomputeDish } from '@/domain/services/rating'
import { aggregateRestaurantStats } from '@/domain/services/restaurantStats'
import { guardDishPatch } from '@/domain/services/nameGuard'
import type { FoodDexDatabase } from './database'

const isoNow = () => new Date().toISOString()

export function createDexieRepositories(db: FoodDexDatabase): Repositories {
  const t = {
    restaurants: db.restaurants,
    dishes: db.dishes,
    logs: db.logs,
    photos: db.photos,
    menuScans: db.menuScans,
    ocrItems: db.ocrItems,
    userProfile: db.userProfile,
  }

  // ── 事务内派生重算 ─────────────────────────────────────────────────────────

  async function refreshRestaurant(rid: ID): Promise<void> {
    const r = await t.restaurants.get(rid)
    if (!r) return
    const rDishes = await t.dishes.where('restaurantId').equals(rid).toArray()
    const rLogs = await t.logs.where('restaurantId').equals(rid).toArray()
    await t.restaurants.put({
      ...r,
      dishIds: rDishes.map((d) => d.id),
      stats: aggregateRestaurantStats(rDishes, rLogs),
      updatedAt: isoNow(),
    })
  }

  async function refreshDish(dishId: ID): Promise<void> {
    const dish = await t.dishes.get(dishId)
    if (!dish) return
    const dishLogs = await t.logs.where('dishId').equals(dishId).toArray()
    await t.dishes.put(recomputeDish(dish, dishLogs, isoNow()))
    await refreshRestaurant(dish.restaurantId)
  }

  // ── Restaurant ─────────────────────────────────────────────────────────────

  const restaurants: RestaurantRepo = {
    async create(input) {
      const r = createRestaurant(input)
      await t.restaurants.add(r)
      return r
    },
    async get(id) {
      return t.restaurants.get(id)
    },
    async search(keyword, limit = 10) {
      const k = keyword.trim().toLowerCase()
      if (!k) return []
      const all = await t.restaurants.toArray()
      return all
        .filter(
          (r) =>
            r.name.toLowerCase().includes(k) || r.aliases.some((a) => a.toLowerCase().includes(k)),
        )
        .slice(0, limit)
    },
    async update(id, patch) {
      const r = await t.restaurants.get(id)
      if (!r) throw new Error(`restaurant not found: ${id}`)
      await t.restaurants.put({ ...r, ...patch, id: r.id, updatedAt: isoNow() })
    },
    async remove(id, opts) {
      await db.transaction('rw', [t.restaurants, t.dishes, t.logs, t.photos], async () => {
        const rDishes = await t.dishes.where('restaurantId').equals(id).toArray()
        if (!opts.keepLogs) {
          const rLogs = await t.logs.where('restaurantId').equals(id).toArray()
          for (const log of rLogs) {
            await t.photos.bulkDelete(log.photoIds)
            await t.logs.delete(log.id)
          }
        }
        await t.dishes.bulkDelete(rDishes.map((d) => d.id))
        await t.restaurants.delete(id)
      })
    },
  }

  // ── Dish ─────────────────────────────────────────────────────────────────

  const dishes: DishRepo = {
    async listByRestaurant(rid) {
      const list = await t.dishes.where('restaurantId').equals(rid).toArray()
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async listByFilter(q) {
      let list = await t.dishes.toArray()
      if (q.ids) list = list.filter((d) => q.ids!.includes(d.id))
      if (q.restaurantId) list = list.filter((d) => d.restaurantId === q.restaurantId)
      if (q.status) list = list.filter((d) => d.status === q.status)
      if (q.isAvoid !== undefined) list = list.filter((d) => d.isAvoid === q.isAvoid)
      if (q.cuisine) list = list.filter((d) => d.tags.some((tag) => tag.value === q.cuisine))
      if (q.tag)
        list = list.filter((d) =>
          d.tags.some((tag) => tag.dim === q.tag!.dim && tag.value === q.tag!.value),
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
    async create(rid, input: DishInput) {
      const r = await t.restaurants.get(rid)
      if (!r) throw new Error(`restaurant not found: ${rid}`)
      const d = createDish(rid, input)
      await t.dishes.add(d)
      await refreshRestaurant(rid)
      return d
    },
    async get(id) {
      return t.dishes.get(id)
    },
    async upsertFromOcr(rid, items) {
      const created: ID[] = []
      const linked: ID[] = []
      await db.transaction('rw', [t.dishes, t.restaurants, t.logs], async () => {
        for (const item of items) {
          // 人工保护：无用户决议不允许入库（PRD §7.7）
          if (!item.userDecision) continue
          if (item.matchType === 'exact' && item.targetDishId) {
            const existing = await t.dishes.get(item.targetDishId)
            if (existing) {
              linked.push(existing.id)
              continue
            }
          }
          const d = createDish(rid, {
            name: item.name,
            nameSource: item.nameSource,
            aiSuggestedName: item.aiSuggestedName,
            section: item.section,
            prices: item.price != null ? [{ price: item.price }] : [],
          })
          await t.dishes.add(d)
          created.push(d.id)
        }
        await refreshRestaurant(rid)
      })
      return { created, linked }
    },
    async setAvoid(id, avoid) {
      const d = await t.dishes.get(id)
      if (!d) throw new Error(`dish not found: ${id}`)
      await t.dishes.put({ ...d, isAvoid: avoid, updatedAt: isoNow() })
      await refreshRestaurant(d.restaurantId)
    },
    async update(id, patch) {
      const d = await t.dishes.get(id)
      if (!d) throw new Error(`dish not found: ${id}`)
      const guarded = guardDishPatch(d, patch)
      await t.dishes.put({ ...d, ...guarded, id: d.id, updatedAt: isoNow() })
    },
    async recomputeDerived(dishId) {
      await refreshDish(dishId)
    },
  }

  // ── Log（打卡原子事务） ───────────────────────────────────────────────────

  const logs: LogRepo = {
    async addMany(inputs: AddLogInput[]): Promise<Log[]> {
      const out: Log[] = []
      await db.transaction('rw', [t.logs, t.photos, t.dishes, t.restaurants], async () => {
        const affectedDishes = new Set<ID>()
        for (const input of inputs) {
          const dish = await t.dishes.get(input.dishId)
          if (!dish) throw new Error(`dish not found: ${input.dishId}`)

          const log = createLog(input)
          log.canonicalDishId = dish.canonicalDishId

          // 图片元信息先行准备，随事务一起提交（Blob 本体已由 BlobStore 事先 put）
          const photoRows: Photo[] = (input.photos ?? []).map((p) => createLogPhoto(log.id, p))
          log.photoIds = photoRows.map((p) => p.id)
          if (photoRows.length > 0) await t.photos.bulkAdd(photoRows)

          await t.logs.add(log)
          out.push(log)
          affectedDishes.add(input.dishId)
        }
        // 每个受影响菜品重算一次（同事务内可见刚写入的 Log）
        for (const dishId of affectedDishes) {
          await refreshDish(dishId)
        }
      })
      return out
    },
    async listByDish(dishId) {
      const list = await t.logs.where('dishId').equals(dishId).toArray()
      return list.sort((a, b) => b.ateAt.localeCompare(a.ateAt))
    },
    async listAll(limit) {
      const list = (await t.logs.toArray()).sort((a, b) => b.ateAt.localeCompare(a.ateAt))
      return limit !== undefined ? list.slice(0, limit) : list
    },
    async remove(id) {
      await db.transaction('rw', [t.logs, t.photos, t.dishes, t.restaurants], async () => {
        const log = await t.logs.get(id)
        if (!log) return
        await t.photos.bulkDelete(log.photoIds)
        await t.logs.delete(id)
        await refreshDish(log.dishId)
      })
    },
    // v1.1 契约追加（T2-05）：见 repositories.ts LogRepo 注释
    async get(id) {
      return t.logs.get(id)
    },
    async update(id, patch) {
      await db.transaction('rw', t.logs, async () => {
        const log = await t.logs.get(id)
        if (!log) throw new Error(`log not found: ${id}`)
        await t.logs.put({ ...log, ...patch, id: log.id, createdAt: log.createdAt })
      })
    },
  }

  // ── Photo ─────────────────────────────────────────────────────────────────

  const photos: PhotoRepo = {
    async attach(meta: PhotoInput) {
      const p = createPhoto(meta)
      await t.photos.add(p)
      return p
    },
    async listByRef(refType, refId) {
      const all = await t.photos.where('refId').equals(refId).toArray()
      return all.filter((p) => p.refType === refType)
    },
    async get(id) {
      return t.photos.get(id)
    },
    async remove(id) {
      await t.photos.delete(id)
    },
  }

  // ── MenuScan / OcrItem ─────────────────────────────────────────────────────

  const menuScans: MenuScanRepo = {
    async create(input) {
      const s = createMenuScan(input)
      await t.menuScans.add(s)
      return s
    },
    async get(id) {
      return t.menuScans.get(id)
    },
    async listByRestaurant(rid) {
      const list = await t.menuScans.where('restaurantId').equals(rid).toArray()
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    async update(id, patch) {
      const s = await t.menuScans.get(id)
      if (!s) throw new Error(`menuScan not found: ${id}`)
      await t.menuScans.put({ ...s, ...patch, id: s.id })
    },
    async addOcrItems(scanId, items) {
      const rows = items.map((it) =>
        createOcrItem({
          scanId,
          sourceImageId: it.sourceImageId,
          section: it.section,
          rawText: it.rawText,
          normalizedName: it.normalizedName,
          price: it.price,
          confidence: it.confidence,
          bbox: it.bbox,
          matchResult: it.matchResult,
        }),
      )
      await t.ocrItems.bulkAdd(rows)
      return rows
    },
    async listOcrItems(scanId) {
      const list = await t.ocrItems.where('scanId').equals(scanId).toArray()
      return list.sort((a, b) => b.confidence - a.confidence)
    },
    async updateOcrItem(id, patch) {
      const o = await t.ocrItems.get(id)
      if (!o) throw new Error(`ocrItem not found: ${id}`)
      await t.ocrItems.put({ ...o, ...patch, id: o.id })
    },
  }

  // ── UserProfile ────────────────────────────────────────────────────────────

  const userProfile: UserProfileRepo = {
    async get() {
      return t.userProfile.get('me')
    },
    async save(profile) {
      await t.userProfile.put(profile)
    },
  }

  return { restaurants, dishes, logs, photos, menuScans, userProfile }
}
