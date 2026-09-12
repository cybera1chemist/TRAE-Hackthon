import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '@/infra/db/__inmemory__'
import { createMockAIProvider, setMockAIFailure, AIError } from '@/infra/ai'
import type { AISnapshot } from '@/domain/entities/log'

/**
 * Agent-3（capture）消费视角的「假打卡」全链路冒烟（分工 §2.7 Mock 优先 / §5 集成门禁）。
 * 覆盖 createLogWorkflow 将依赖的契约面：
 *   店铺联想/新建 → ai.recognizeDish（置信度三档）→ 手添建菜 →
 *   BlobStore.put → logs.addMany（照片/快照/pending 标签）→ 派生字段重算 →
 *   AI 失败降级触发点（T2-04 的 15s 超时降级）→ 事务回滚。
 * Agent-1 Dexie 落地后本测试不改语义，仅替换数据层实现。
 */

const snapshotOf = (name: string, confidence: number, candidates: string[]): AISnapshot => ({
  recognizedName: name,
  confidence,
  candidates,
  modelVendor: 'mock',
  modelVersion: 'vision-mock-1',
})

describe('打卡全链路（in-memory repos × mock AI）', () => {
  const { repos, blobStore, db } = createInMemoryRepositories()
  const ai = createMockAIProvider({ latencyMs: 1 })

  beforeEach(() => {
    db.reset()
    setMockAIFailure('none')
  })

  it('高置信主链路：店铺 → 识别 → 建菜 → BlobStore → addMany → 解锁派生', async () => {
    // 1. 店铺联想：无结果 → 新建（EC 打卡页店铺联想路径）
    expect(await repos.restaurants.search('川香')).toHaveLength(0)
    const r = await repos.restaurants.create({ name: '川香小馆（大学城店）', city: '广州' })
    expect(await repos.restaurants.search('川香')).toHaveLength(1)

    // 2. Mock 识别：高置信 0.91（直接预填）+ 中置信 0.62（黄档请确认）
    const resp = await ai.recognizeDish({ images: ['b64'], context: { restaurantId: r.id } })
    const dishes = resp.results[0]?.dishes ?? []
    expect(dishes).toHaveLength(2)
    expect(dishes[0]).toMatchObject({ name: '水煮牛肉', confidence: 0.91 })
    expect(dishes[1]?.confidence).toBeGreaterThanOrEqual(0.5)
    expect(dishes[1]?.confidence).toBeLessThan(0.8)

    // 3. 确认后建菜（用户输入为最终值，保留 aiSuggestedName）
    const d = await repos.dishes.create(r.id, {
      name: '水煮牛肉',
      nameSource: 'ai',
      aiSuggestedName: '水煮牛肉',
    })

    // 4. 压缩后的图片先入 BlobStore，再在 addMany 里登记元信息
    const blob = new Blob(['fake-jpeg'], { type: 'image/jpeg' })
    const blobKey = await blobStore.put('img-001.jpg', blob)

    // 5. 打卡事务：照片/快照随 Log 落库，标签状态强制 pending（AsyncQueue 稍后回填）
    const [log] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 4.5,
        manualAvoid: false,
        comment: '牛肉滑嫩',
        price: 58,
        scene: '聚餐',
        ateAt: '2026-09-12T12:00:00.000Z',
        photos: [{ blobKey, width: 1600, height: 1200, sizeBytes: blob.size, isCover: true }],
        aiSnapshot: snapshotOf('水煮牛肉', 0.91, ['水煮牛肉', '水煮鱼', '毛血旺']),
      },
    ])
    expect(log.photoIds).toHaveLength(1)
    expect(log.tagExtractionState).toBe('pending')
    expect(log.aiSnapshot).toMatchObject({ recognizedName: '水煮牛肉' })
    expect(await blobStore.get(blobKey)).toBeInstanceOf(Blob)

    // 6. 派生字段重算：解锁 + 统计（首解触发解锁动效的判定依据）
    const dish = await repos.dishes.get(d.id)
    expect(dish).toMatchObject({
      status: 'unlocked',
      isAvoid: false,
      stats: { logCount: 1, avgRating: 4.5, latestRating: 4.5 },
    })
    const restaurant = await repos.restaurants.get(r.id)
    expect(restaurant?.stats).toMatchObject({ logCount: 1, unlockedCount: 1 })
  })

  it('识别失败降级触发点：timeout 注入归一为可重试 AIError（T2-04 的 15s 降级前提）', async () => {
    setMockAIFailure('timeout')
    const err = await ai.recognizeDish({ images: ['b64'] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err).toMatchObject({ code: 'TIMEOUT', retriable: true })
  })

  it('保存事务原子性：addMany 中途失败整体回滚，不产生半条打卡', async () => {
    const r = await repos.restaurants.create({ name: '回滚面馆' })
    const d = await repos.dishes.create(r.id, { name: '担担面', nameSource: 'user' })
    const [first] = await repos.logs.addMany([
      {
        dishId: d.id,
        restaurantId: r.id,
        rating: 3,
        manualAvoid: false,
        ateAt: '2026-09-11T12:00:00.000Z',
      },
    ])

    db.options.failNextAddMany = true
    await expect(
      repos.logs.addMany([
        {
          dishId: d.id,
          restaurantId: r.id,
          rating: 5,
          manualAvoid: false,
          ateAt: '2026-09-12T12:00:00.000Z',
        },
      ]),
    ).rejects.toThrow()

    // 回滚后：仅剩首条 Log，统计未被第二次写入污染
    const logs = await repos.logs.listByDish(d.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.id).toBe(first.id)
    expect((await repos.dishes.get(d.id))?.stats.logCount).toBe(1)
  })
})
