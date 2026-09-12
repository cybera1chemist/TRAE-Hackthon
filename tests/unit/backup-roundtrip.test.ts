import '../helpers/useNodeBlob'
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BlobDatabase, FoodDexDatabase } from '@/infra/db/database'
import { createDexieRepositories } from '@/infra/db/dexieRepositories'
import { IdbBlobStore } from '@/infra/blob/IdbBlobStore'
import type { Repositories } from '@/infra/db/repositories'
import {
  applyBackup,
  base64ToBlob,
  blobToBase64,
  exportBackup,
  isPhotoVolume,
  parseBackupText,
  stringifyBackup,
  stringifyVolume,
} from '@/infra/backup'
import { validateBackupPackage } from '@/infra/backup/format'
import { createDefaultProfile } from '@/domain/factories'

let seq = 0
let db: FoodDexDatabase
let blobStore: IdbBlobStore
let repos: Repositories

async function openLayer(tag: string) {
  const d = new FoodDexDatabase(`test-backup-${tag}-${++seq}`)
  const b = new BlobDatabase(`test-backup-blob-${tag}-${seq}`)
  await Promise.all([d.open(), b.open()])
  return { d, b, bs: new IdbBlobStore(b), r: createDexieRepositories(d) }
}

function blobOf(n: number, type = 'image/jpeg'): Blob {
  return new Blob([new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7) % 256))], { type })
}

beforeEach(async () => {
  const layer = await openLayer('src')
  db = layer.d
  blobStore = layer.bs
  repos = layer.r
})

async function seedSource() {
  const r = await repos.restaurants.create({ name: '川香小馆', city: '广州' })
  const d = await repos.dishes.create(r.id, { name: '水煮牛肉', nameSource: 'user' })
  const key = await blobStore.put('seed-photo', blobOf(100, 'image/jpeg'))
  const [log] = await repos.logs.addMany([
    {
      dishId: d.id,
      restaurantId: r.id,
      rating: 5,
      manualAvoid: false,
      comment: '好吃',
      ateAt: '2024-06-01T12:00:00Z',
      photos: [{ blobKey: key, width: 10, height: 10, sizeBytes: 100 }],
    },
  ])
  await repos.userProfile.save(createDefaultProfile())
  return { r, d, log, key }
}

describe('base64 工具往返', () => {
  it('含二进制 0 字节往返一致', async () => {
    const original = new Blob([new Uint8Array([0, 1, 255, 128, 1, 0])], { type: 'image/png' })
    const b64 = await blobToBase64(original)
    const back = base64ToBlob(b64, 'image/png')
    expect(back.type).toBe('image/png')
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([0, 1, 255, 128, 1, 0])
  })
})

describe('exportBackup', () => {
  it('带图导出：主包 + 图片卷；无图导出：无卷', async () => {
    await seedSource()
    const result = await exportBackup(db, blobStore, { photos: 'base64' })
    expect(result.pkg.photos).toBe('base64')
    expect(result.photoCount).toBe(1)
    expect(result.photoBytes).toBe(100)
    expect(result.photoVolumes).toHaveLength(1)
    expect(result.photoVolumes[0]).toMatchObject({ part: 'photos', index: 0, total: 1 })
    expect(result.pkg.data.restaurants).toHaveLength(1)
    expect(result.pkg.data.logs).toHaveLength(1)
    expect(isPhotoVolume(result.photoVolumes[0])).toBe(true)
    // 序列化往返
    expect(parseBackupText(stringifyBackup(result.pkg))).toBeTruthy()
    expect(parseBackupText(stringifyVolume(result.photoVolumes[0]))).toBeTruthy()

    const none = await exportBackup(db, blobStore, { photos: 'none' })
    expect(none.photoVolumes).toEqual([])
    expect(none.photoCount).toBe(0)
    expect(validateBackupPackage(none.pkg)).toEqual({ ok: true })
  })
})

describe('applyBackup 端到端', () => {
  it('空库完整恢复：ID 全部重映射、Blob 落库、派生字段自愈', async () => {
    const seeded = await seedSource()
    const exported = await exportBackup(db, blobStore, { photos: 'base64' })

    const target = await openLayer('dst-full')
    const res = await applyBackup(target.d, target.bs, exported.pkg, {
      photoVolumes: exported.photoVolumes,
    })

    expect(res.imported).toMatchObject({ restaurants: 1, dishes: 1, logs: 1, photos: 1, blobs: 1 })
    expect(res.skippedDishes).toBe(0)

    const r = await target.d.restaurants.toArray()
    const d = await target.d.dishes.toArray()
    const logs = await target.d.logs.toArray()
    const photos = await target.d.photos.toArray()
    expect(r).toHaveLength(1)
    expect(d).toHaveLength(1)
    expect(logs).toHaveLength(1)
    expect(photos).toHaveLength(1)

    // 新 ID，不沿用源库
    expect(r[0].id).not.toBe(seeded.r.id)
    expect(d[0].id).not.toBe(seeded.d.id)
    expect(logs[0].id).not.toBe(seeded.log.id)
    // 引用链完整重映射
    expect(logs[0].dishId).toBe(d[0].id)
    expect(logs[0].restaurantId).toBe(r[0].id)
    expect(logs[0].photoIds).toEqual([photos[0].id])
    expect(photos[0].refId).toBe(logs[0].id)
    expect(photos[0].refType).toBe('log')

    // 派生字段自愈：菜已解锁、店铺统计正确
    expect(d[0].status).toBe('unlocked')
    expect(d[0].firstLogId).toBe(logs[0].id)
    expect(d[0].stats.avgRating).toBe(5)
    expect(r[0].stats).toMatchObject({ dishTotal: 1, unlockedCount: 1, logCount: 1, avgRating: 5 })

    // Blob 可还原且字节一致
    const restoredBlob = await target.bs.get(photos[0].blobKey)
    expect(restoredBlob?.size).toBe(100)
    expect([...new Uint8Array(await restoredBlob!.arrayBuffer())].slice(0, 4)).toEqual([
      0, 7, 14, 21,
    ])
    // 用户档案恢复
    expect(await target.d.userProfile.get('me')).toBeTruthy()
    target.d.close()
    target.b.close()
  })

  it('同名店铺 + exact 同名菜：并入现有菜，不新建，Log 触发重算', async () => {
    const seeded = await seedSource()
    const exported = await exportBackup(db, blobStore, { photos: 'none' })

    const target = await openLayer('dst-merge')
    // 目标库已有同名店、同名菜，且菜上有一条旧的好评 Log
    const er = await target.r.restaurants.create({ name: '川香小馆', city: '深圳' })
    const ed = await target.r.dishes.create(er.id, { name: '水煮牛肉', nameSource: 'ocr' })
    await target.r.logs.addMany([
      {
        dishId: ed.id,
        restaurantId: er.id,
        rating: 3,
        manualAvoid: false,
        ateAt: '2024-01-01T00:00:00Z',
      },
    ])

    const res = await applyBackup(target.d, target.bs, exported.pkg, {})
    expect(res.imported.restaurants).toBe(0)
    expect(res.imported.dishes).toBe(0)
    expect(res.imported.logs).toBe(1)

    expect(await target.d.restaurants.count()).toBe(1)
    expect(await target.d.dishes.count()).toBe(1)
    const logs = await target.d.logs.toArray()
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.dishId === ed.id)).toBe(true)
    // 重算后均分 = (3 + 5) / 2
    const refreshed = await target.r.dishes.get(ed.id)
    expect(refreshed?.stats.logCount).toBe(2)
    expect(refreshed?.stats.avgRating).toBe(4)
    expect(refreshed?.status).toBe('unlocked')
    // 源 Log 的 id 未被沿用
    expect(logs.map((l) => l.id)).not.toContain(seeded.log.id)
    target.d.close()
    target.b.close()
  })

  it('fuzzy 冲突：无决议跳过（菜与 Log）；separate 决议建新菜并入账', async () => {
    await seedSource() // 川香小馆 / 水煮牛肉
    // 构造一个 fuzzy 备份：同店名，菜名「水煮牛肉饭」
    const exported = await exportBackup(db, blobStore, { photos: 'none' })
    exported.pkg.data.dishes[0].name = '水煮牛肉饭'

    // 场景 A：目标库已有「水煮牛肉」→ 备份菜 fuzzy，无决议 → 跳过
    const t1 = await openLayer('dst-fuzzy-skip')
    const r1 = await t1.r.restaurants.create({ name: '川香小馆' })
    await t1.r.dishes.create(r1.id, { name: '水煮牛肉', nameSource: 'ocr' })
    const res1 = await applyBackup(t1.d, t1.bs, exported.pkg, {})
    expect(res1.skippedDishes).toBe(1)
    expect(await t1.d.dishes.count()).toBe(1)
    expect(await t1.d.logs.count()).toBe(0)
    t1.d.close()
    t1.b.close()

    // 场景 B：用户决议 separate → 建新菜，Log 随新菜入账
    const t2 = await openLayer('dst-fuzzy-separate')
    const r2 = await t2.r.restaurants.create({ name: '川香小馆' })
    const existingDish = await t2.r.dishes.create(r2.id, { name: '水煮牛肉', nameSource: 'ocr' })
    const incomingId = exported.pkg.data.dishes[0].id
    const res2 = await applyBackup(t2.d, t2.bs, exported.pkg, {
      decisions: { [incomingId]: 'separate' },
    })
    expect(res2.skippedDishes).toBe(0)
    expect(res2.imported.dishes).toBe(1)
    expect(res2.imported.logs).toBe(1)
    const dishes = await t2.d.dishes.toArray()
    expect(dishes).toHaveLength(2)
    const newDish = dishes.find((x) => x.id !== existingDish.id)!
    expect(newDish.name).toBe('水煮牛肉饭')
    expect(newDish.status).toBe('unlocked')
    t2.d.close()
    t2.b.close()
  })

  it('高版本备份直接拒绝，不写任何数据', async () => {
    const exported = await exportBackup(db, blobStore, { photos: 'none' })
    const target = await openLayer('dst-reject')
    exported.pkg.schemaVersion = 999
    await expect(applyBackup(target.d, target.bs, exported.pkg, {})).rejects.toThrow(/升级应用/)
    expect(await target.d.restaurants.count()).toBe(0)
    target.d.close()
    target.b.close()
  })
})
