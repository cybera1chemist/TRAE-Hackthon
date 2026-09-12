import '../helpers/useNodeBlob'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createDataLayer, destroyDataLayer, detectIndexedDb, isIndexedDbPresent } from '@/infra/db'

describe('IDB 探测（T1-01）', () => {
  it('fake-indexeddb 环境下探测为真', async () => {
    expect(isIndexedDbPresent()).toBe(true)
    expect(await detectIndexedDb()).toBe(true)
  })
})

describe('createDataLayer 组装与降级（TDD §7.2）', () => {
  it('force=memory：内存模式，Repository 可正常读写', async () => {
    const layer = await createDataLayer({ force: 'memory', requestPersistence: false })
    expect(layer.mode).toBe('memory')
    expect(layer.db).toBeUndefined()
    expect(layer.persisted).toBe(false)

    const r = await layer.repos.restaurants.create({ name: '内存小店' })
    expect(await layer.repos.restaurants.get(r.id)).toBeTruthy()
    const key = await layer.blobStore.put('k', new Blob([new Uint8Array([1])]))
    expect(await layer.blobStore.get(key)).toBeTruthy()
  })

  it('默认为 idb 模式：Dexie 库可用，destroy 后清空', async () => {
    const layer = await createDataLayer({
      dbName: 'test-datalayer-idb',
      requestPersistence: false,
    })
    expect(layer.mode).toBe('idb')
    expect(layer.db).toBeTruthy()

    const r = await layer.repos.restaurants.create({ name: '持久小店' })
    const d = await layer.repos.dishes.create(r.id, { name: '招牌菜', nameSource: 'user' })
    await layer.repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 5,
        manualAvoid: false,
        ateAt: '2024-06-01T00:00:00Z',
      },
    ])
    expect((await layer.repos.dishes.get(d.id))?.status).toBe('unlocked')

    await destroyDataLayer(layer)
    // 销毁后业务库已删除（同名重建为空库）
    const reopened = await createDataLayer({
      dbName: 'test-datalayer-idb',
      requestPersistence: false,
    })
    expect(await reopened.db!.restaurants.count()).toBe(0)
    await destroyDataLayer(reopened)
  })
})
