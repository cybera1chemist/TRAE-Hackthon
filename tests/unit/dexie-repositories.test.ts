import '../helpers/useNodeBlob'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlobDatabase, FoodDexDatabase } from '@/infra/db/database'
import { createDexieRepositories } from '@/infra/db/dexieRepositories'
import type { Repositories } from '@/infra/db/repositories'
import type { ResolvedOcrItem } from '@/domain/entities'
import { IdbBlobStore } from '@/infra/blob/IdbBlobStore'
import { recomputeAll } from '@/infra/db/maintenance'
import {
  clearAllImages,
  getStorageBreakdown,
  pruneImagesOlderThanOneYear,
} from '@/infra/blob/storageManager'

const DB_NAME = 'test-fooddex-contract'
const BLOB_NAME = 'test-fooddex-blobs'

let db: FoodDexDatabase
let blobDb: BlobDatabase
let blobStore: IdbBlobStore
let repos: Repositories
let seq = 0

// 每个测试使用唯一库名（fake-indexeddb 下 delete+reopen 存在连接竞态，唯一名最稳）
beforeEach(async () => {
  seq += 1
  db = new FoodDexDatabase(`${DB_NAME}-${seq}`)
  blobDb = new BlobDatabase(`${BLOB_NAME}-${seq}`)
  await Promise.all([db.open(), blobDb.open()])
  blobStore = new IdbBlobStore(blobDb)
  repos = createDexieRepositories(db)
})

afterEach(async () => {
  db.close()
  blobDb.close()
})

function blobOf(n: number, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(Array.from({ length: n }, (_, i) => i % 256))], { type })
}

async function seedRestaurant() {
  return repos.restaurants.create({ name: '川香小馆', city: '广州' })
}

describe('Dexie 打卡全链路（T1-03 契约）', () => {
  it('建店建菜 → 打卡 → 解锁/统计/店铺聚合全部派生', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '水煮牛肉', nameSource: 'user' })

    const key = await blobStore.put('p1', blobOf(10))
    const [log] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: '2024-06-01T12:00:00Z',
        photos: [{ blobKey: key, width: 4, height: 3, sizeBytes: 10 }],
      },
    ])

    const afterDish = await repos.dishes.get(d.id)
    expect(afterDish?.status).toBe('unlocked')
    expect(afterDish?.firstLogId).toBe(log.id)
    expect(afterDish?.stats.logCount).toBe(1)
    expect(afterDish?.stats.avgRating).toBe(5)
    expect(log.photoIds).toHaveLength(1)

    const afterRestaurant = await repos.restaurants.get(r.id)
    expect(afterRestaurant?.dishIds).toEqual([d.id])
    expect(afterRestaurant?.stats).toMatchObject({
      dishTotal: 1,
      unlockedCount: 1,
      avoidCount: 0,
      avgRating: 5,
      logCount: 1,
    })

    // Photo 行与 Blob 都可读（校验字节，防止 Blob 克隆丢 slot 的假阳性）
    const photo = await repos.photos.get(log.photoIds[0])
    expect(photo?.refId).toBe(log.id)
    const stored = await blobStore.get(key)
    expect(stored?.size).toBe(10)
    expect(stored?.type).toBe('image/jpeg')
    const bytes = new Uint8Array(await stored!.arrayBuffer())
    expect(bytes).toHaveLength(10)
    expect(bytes[9]).toBe(9)
  })

  it('低分打卡触发避雷；删除 Log 后解除；setAvoid 与打卡事实的关系', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '苦菊', nameSource: 'ocr' })

    const [l1] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 2,
        manualAvoid: false,
        ateAt: '2024-06-01T12:00:00Z',
      },
    ])
    expect((await repos.dishes.get(d.id))?.isAvoid).toBe(true)

    await repos.logs.remove(l1.id)
    const recovered = await repos.dishes.get(d.id)
    expect(recovered?.status).toBe('locked')
    expect(recovered?.firstLogId).toBeUndefined()
    expect(recovered?.isAvoid).toBe(false)
    expect(recovered?.stats.logCount).toBe(0)

    // setAvoid 是无 Log 菜的手动开关；一旦出现好评打卡，避雷以打卡事实重算解除
    await repos.dishes.setAvoid(d.id, true)
    expect((await repos.dishes.get(d.id))?.isAvoid).toBe(true)
    const [l2] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: '2024-07-01T12:00:00Z',
      },
    ])
    expect((await repos.dishes.get(d.id))?.isAvoid).toBe(false)
    await repos.logs.remove(l2.id)
    expect((await repos.dishes.get(d.id))?.status).toBe('locked')
  })

  it('addMany 任一条失败 → 整个事务回滚（Log/Photo/派生不留痕）', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '回滚菜', nameSource: 'user' })
    const key = await blobStore.put('rollback', blobOf(5))

    await expect(
      repos.logs.addMany([
        {
          dishId: d.id,
          restaurantId: r.id,
          rating: 5,
          manualAvoid: false,
          ateAt: '2024-06-01T12:00:00Z',
          photos: [{ blobKey: key, width: 1, height: 1, sizeBytes: 5 }],
        },
        {
          dishId: 'dsh_does_not_exist',
          restaurantId: r.id,
          rating: 4,
          manualAvoid: false,
          ateAt: '2024-06-02T12:00:00Z',
        },
      ]),
    ).rejects.toThrow(/dish not found/)

    expect(await repos.logs.listByDish(d.id)).toHaveLength(0)
    expect(await db.photos.count()).toBe(0)
    expect((await repos.dishes.get(d.id))?.status).toBe('locked')
    // Blob 本体在业务事务外（先 put），不回滚——这是设计约定
    expect(await blobStore.get(key)).toBeDefined()
  })

  it('DishRepo.remove：级联删 Log/Photo/dish 图并重算店铺；keepLogs 保留 Log（EC-MENU-05）', async () => {
    const r = await seedRestaurant()
    const d1 = await repos.dishes.create(r.id, { name: '下架菜', nameSource: 'ocr' })
    const d2 = await repos.dishes.create(r.id, { name: '在售菜', nameSource: 'ocr' })
    const key = await blobStore.put('rm1', blobOf(8))
    const [log] = await repos.logs.addMany([
      {
        dishId: d1.id,
        restaurantId: r.id,
        rating: 4,
        manualAvoid: false,
        ateAt: '2024-06-01T12:00:00Z',
        photos: [{ blobKey: key, width: 1, height: 1, sizeBytes: 8 }],
      },
    ])
    await repos.photos.attach({
      refType: 'dish',
      refId: d1.id,
      blobKey: key,
      width: 1,
      height: 1,
      sizeBytes: 8,
    })

    await repos.dishes.remove(d1.id, {})
    expect(await repos.dishes.get(d1.id)).toBeUndefined()
    expect(await repos.logs.listByDish(d1.id)).toHaveLength(0)
    expect(await repos.photos.get(log.photoIds[0])).toBeUndefined()
    expect(await db.photos.count()).toBe(0)
    expect((await repos.restaurants.get(r.id))?.dishIds).toEqual([d2.id])

    // keepLogs=true：仅删菜品行与 dish 级图片，打卡记录保留
    const [log2] = await repos.logs.addMany([
      {
        dishId: d2.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: '2024-06-02T12:00:00Z',
      },
    ])
    await repos.dishes.remove(d2.id, { keepLogs: true })
    expect(await repos.dishes.get(d2.id)).toBeUndefined()
    expect(await repos.logs.get(log2.id)).toBeDefined()
  })
})

describe('upsertFromOcr（无决议不入库，PRD §7.7）', () => {
  it('exact 关联、new 建菜、无 userDecision 跳过', async () => {
    const r = await seedRestaurant()
    const existing = await repos.dishes.create(r.id, { name: '宫保鸡丁', nameSource: 'ocr' })

    const { created, linked } = await repos.dishes.upsertFromOcr(r.id, [
      {
        name: '宫保鸡丁',
        nameSource: 'ocr',
        matchType: 'exact',
        targetDishId: existing.id,
        userDecision: 'linked',
      },
      { name: '鱼香肉丝', nameSource: 'ocr', matchType: 'new', userDecision: 'keptSeparate' },
      // 运行时防御：即便脏数据缺 userDecision（类型上不可能），也必须跳过
      {
        name: '不该进来的菜',
        nameSource: 'ocr',
        matchType: 'new',
        userDecision: undefined as unknown as ResolvedOcrItem['userDecision'],
      },
    ])

    expect(linked).toEqual([existing.id])
    expect(created).toHaveLength(1)
    const dishes = await repos.dishes.listByRestaurant(r.id)
    expect(dishes.map((x) => x.name).sort()).toEqual(['宫保鸡丁', '鱼香肉丝'])
  })
})

describe('nameGuard 集成', () => {
  it('user 菜名不被 AI 通道覆盖，建议落到 aiSuggestedName', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '我妈做的红烧肉', nameSource: 'user' })
    await repos.dishes.update(d.id, { name: '红烧肉', nameSource: 'ai' })
    const after = await repos.dishes.get(d.id)
    expect(after?.name).toBe('我妈做的红烧肉')
    expect(after?.nameSource).toBe('user')
    expect(after?.aiSuggestedName).toBe('红烧肉')
  })
})

describe('IdbBlobStore（T1-04）', () => {
  it('key 归一 + put/get/delete', async () => {
    const key = await blobStore.put('abc', blobOf(3, 'image/png'))
    expect(key).toBe('idb://blobs/abc')
    // 已带前缀与裸 key 等价；字节级往返校验一次即可
    // （注：fake-indexeddb 每次 get 都会结构化克隆 Blob，Node 下嵌套超 ~10 层会
    // 物化为空，故此处不做无意义的反复读取；浏览器环境无此限制）
    const byFullKey = await blobStore.get('idb://blobs/abc')
    expect(byFullKey?.size).toBe(3)
    expect(byFullKey?.type).toBe('image/png')
    expect([...new Uint8Array(await byFullKey!.arrayBuffer())]).toEqual([0, 1, 2])
    expect((await blobStore.get('abc'))?.size).toBe(3)
    await blobStore.delete('abc')
    expect(await blobStore.get('abc')).toBeUndefined()
  })
})

describe('recomputeAll 自愈（T5-06）', () => {
  it('手工塞入脏数据（locked 但有 Log）→ 重算后 unlocked + 店铺统计正确', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '脏数据菜', nameSource: 'ocr' })
    // 绕过仓储直接写 Log（模拟历史脏数据）
    await db.logs.add({
      id: 'log_dirty',
      dishId: d.id,
      restaurantId: r.id,
      rating: 1,
      manualAvoid: false,
      comment: '',
      price: null,
      ateAt: '2024-01-01T00:00:00Z',
      photoIds: [],
      tagExtractionState: 'done',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })
    expect((await repos.dishes.get(d.id))?.status).toBe('locked')

    const res = await recomputeAll(db)
    expect(res.dishes).toBeGreaterThanOrEqual(1)
    const fixed = await repos.dishes.get(d.id)
    expect(fixed?.status).toBe('unlocked')
    expect(fixed?.firstLogId).toBe('log_dirty')
    expect(fixed?.isAvoid).toBe(true)
    expect((await repos.restaurants.get(r.id))?.stats.logCount).toBe(1)
  })
})

describe('存储管理（T5-06）', () => {
  it('占用明细统计', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '存储菜', nameSource: 'ocr' })
    const key = await blobStore.put('s1', blobOf(100))
    await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 4,
        manualAvoid: false,
        ateAt: '2024-06-01T12:00:00Z',
        photos: [{ blobKey: key, width: 10, height: 10, sizeBytes: 100 }],
      },
    ])
    const breakdown = await getStorageBreakdown(db, blobStore)
    expect(breakdown.blobBytes).toBe(100)
    expect(breakdown.counts).toMatchObject({ restaurants: 1, dishes: 1, logs: 1, photos: 1 })
  })

  it('仅删一年前的图片，文字与新图保留', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '清理菜', nameSource: 'ocr' })
    const oldKey = await blobStore.put('old', blobOf(10))
    const newKey = await blobStore.put('new', blobOf(20))
    const now = new Date('2024-06-01T12:00:00Z')
    const day = 24 * 60 * 60 * 1000

    const [oldLog] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 4,
        manualAvoid: false,
        ateAt: new Date(now.getTime() - 400 * day).toISOString(),
        photos: [{ blobKey: oldKey, width: 1, height: 1, sizeBytes: 10 }],
      },
    ])
    await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: new Date(now.getTime() - 10 * day).toISOString(),
        photos: [{ blobKey: newKey, width: 2, height: 2, sizeBytes: 20 }],
      },
    ])

    const res = await pruneImagesOlderThanOneYear(db, blobStore, now)
    expect(res.deletedPhotos).toBe(1)
    expect(res.freedBytes).toBe(10)
    expect(await blobStore.get('old')).toBeUndefined()
    const kept = await blobStore.get('new')
    expect(kept?.size).toBe(20)
    expect(new Uint8Array(await kept!.arrayBuffer())).toHaveLength(20)
    // 文字记录保留，老 Log 的引用被清空
    expect((await db.logs.get(oldLog.id))?.photoIds).toEqual([])
    expect(await db.logs.count()).toBe(2)
    expect(await db.photos.count()).toBe(1)
  })

  it('清空全部图片：Blob/Photo 清空，Log 与菜状态保留', async () => {
    const r = await seedRestaurant()
    const d = await repos.dishes.create(r.id, { name: '全清菜', nameSource: 'ocr' })
    const key = await blobStore.put('k', blobOf(7))
    await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: '2024-06-01T12:00:00Z',
        photos: [{ blobKey: key, width: 1, height: 1, sizeBytes: 7 }],
      },
    ])

    const res = await clearAllImages(db, blobStore)
    expect(res.deletedPhotos).toBe(1)
    expect(await blobDb.blobs.count()).toBe(0)
    expect(await db.photos.count()).toBe(0)
    expect(await db.logs.count()).toBe(1)
    expect((await db.logs.toArray())[0].photoIds).toEqual([])
    expect((await repos.dishes.get(d.id))?.status).toBe('unlocked')
  })
})
