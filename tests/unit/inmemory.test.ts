import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '@/infra/db/__inmemory__'

/**
 * “假打卡”全链路验收（分工文档 Agent-0 验收标准）：
 * 批次 3 Agent 用内存假实现 + Mock AI 能跑通 建店 → 建菜 → 打卡保存 → 解锁/避雷派生。
 */

const ateAt = '2026-09-12T19:30:00+08:00'
const photoInput = {
  blobKey: 'idb://blobs/test.jpg',
  width: 1600,
  height: 1200,
  sizeBytes: 482130,
  isCover: true,
}

describe('InMemory 假打卡全链路', () => {
  let ctx: ReturnType<typeof createInMemoryRepositories>
  beforeEach(() => {
    ctx = createInMemoryRepositories()
  })

  it('建店 → 建菜 → 打卡 → 解锁与统计派生', async () => {
    const { repos } = ctx
    const r = await repos.restaurants.create({ name: '川香小馆（大学城店）', city: '广州' })
    const d = await repos.dishes.create(r.id, { name: '水煮牛肉', nameSource: 'user' })
    expect(d.status).toBe('locked')

    const logs = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 4.5,
        manualAvoid: false,
        ateAt,
        photos: [photoInput],
      },
    ])
    expect(logs).toHaveLength(1)
    expect(logs[0].photoIds).toHaveLength(1)
    expect(logs[0].tagExtractionState).toBe('pending')

    const after = await repos.dishes.get(d.id)
    expect(after?.status).toBe('unlocked')
    expect(after?.stats.logCount).toBe(1)
    expect(after?.stats.avgRating).toBe(4.5)
    expect(after?.firstLogId).toBe(logs[0].id)

    const rs = await repos.restaurants.get(r.id)
    expect(rs?.stats).toMatchObject({ dishTotal: 1, unlockedCount: 1, logCount: 1 })
  })

  it('避雷：任一低分或手标触发；撤销后重算恢复（T1-05 验收）', async () => {
    const { repos } = ctx
    const r = await repos.restaurants.create({ name: 'A' })
    const d = await repos.dishes.create(r.id, { name: '雷菜', nameSource: 'user' })
    await repos.logs.addMany([
      { dishId: d.id, restaurantId: r.id, rating: 5, manualAvoid: false, ateAt },
      { dishId: d.id, restaurantId: r.id, rating: 1.5, manualAvoid: false, ateAt },
    ])
    let after = await repos.dishes.get(d.id)
    expect(after?.isAvoid).toBe(true)

    // 撤销 = 删除避雷那条 Log 后重算（不能只看最新一条）
    const all = await repos.logs.listByDish(d.id)
    const bad = all.find((l) => l.rating === 1.5)
    await repos.logs.remove(bad!.id)
    after = await repos.dishes.get(d.id)
    expect(after?.isAvoid).toBe(false)
    expect(after?.stats.logCount).toBe(1)

    // 手动标记（无评分）
    const d2 = await repos.dishes.create(r.id, { name: '手标雷', nameSource: 'user' })
    await repos.logs.addMany([
      { dishId: d2.id, restaurantId: r.id, rating: null, manualAvoid: true, ateAt },
    ])
    expect((await repos.dishes.get(d2.id))?.isAvoid).toBe(true)
  })

  it('删光 Log 回 locked（T1-05 验收）', async () => {
    const { repos } = ctx
    const r = await repos.restaurants.create({ name: 'B' })
    const d = await repos.dishes.create(r.id, { name: '回锅肉', nameSource: 'user' })
    const [log] = await repos.logs.addMany([
      { dishId: d.id, restaurantId: r.id, rating: 4, manualAvoid: false, ateAt },
    ])
    await repos.logs.remove(log.id)
    const after = await repos.dishes.get(d.id)
    expect(after?.status).toBe('locked')
    expect(after?.unlockedAt).toBeUndefined()
  })

  it('addMany 伪事务：失败整体回滚', async () => {
    const { repos, db } = ctx
    const r = await repos.restaurants.create({ name: 'C' })
    const d = await repos.dishes.create(r.id, { name: '水煮鱼', nameSource: 'user' })

    db.options.failNextAddMany = true
    await expect(
      repos.logs.addMany([
        {
          dishId: d.id,
          restaurantId: r.id,
          rating: 3,
          manualAvoid: false,
          ateAt,
          photos: [photoInput],
        },
      ]),
    ).rejects.toThrow()
    expect(await repos.logs.listByDish(d.id)).toHaveLength(0)
    expect((await repos.dishes.get(d.id))?.status).toBe('locked')
  })

  it('BlobStore：put/get/delete/usage（分工 §3 契约）', async () => {
    const { blobStore } = ctx
    const blob = new Blob(['fake-image'], { type: 'image/jpeg' })
    const key = await blobStore.put('test.jpg', blob)
    expect(key.startsWith('idb://blobs/')).toBe(true)
    expect((await blobStore.get(key))?.size).toBe(blob.size)
    const usage = await blobStore.usage()
    expect(usage.usage).toBe(blob.size)
    await blobStore.delete(key)
    expect(await blobStore.get(key)).toBeUndefined()
  })

  it('nameSource=user 的人工菜名保护（TDD §6）', async () => {
    const { repos } = ctx
    const r = await repos.restaurants.create({ name: 'D' })
    const d = await repos.dishes.create(r.id, { name: '我妈做的红烧肉', nameSource: 'user' })
    await repos.dishes.update(d.id, { name: 'AI 建议名', nameSource: 'ai' })
    const after = await repos.dishes.get(d.id)
    expect(after?.name).toBe('我妈做的红烧肉')
    expect(after?.aiSuggestedName).toBe('AI 建议名')
    expect(after?.nameSource).toBe('user')
  })
})
