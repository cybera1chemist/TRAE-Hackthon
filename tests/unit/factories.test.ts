import { describe, expect, it } from 'vitest'
import {
  createDefaultProfile,
  createDish,
  createLog,
  createMenuScan,
  createPhoto,
  createRestaurant,
  genId,
} from '@/domain/factories'

describe('genId 前缀约定', () => {
  it('各前缀正确且同前缀不重复', () => {
    expect(genId('rst')).toMatch(/^rst_/)
    expect(genId('dsh')).toMatch(/^dsh_/)
    expect(genId('log')).toMatch(/^log_/)
    expect(genId('pho')).toMatch(/^pho_/)
    const ids = new Set(Array.from({ length: 1000 }, () => genId('job')))
    expect(ids.size).toBe(1000)
  })
})

describe('实体工厂默认值（T1-02）', () => {
  it('createRestaurant', () => {
    const r = createRestaurant({ name: '川香小馆', city: '广州' }, '2024-01-01T00:00:00Z')
    expect(r.id).toMatch(/^rst_/)
    expect(r.aliases).toEqual([])
    expect(r.dishIds).toEqual([])
    expect(r.stats).toEqual({
      dishTotal: 0,
      unlockedCount: 0,
      avoidCount: 0,
      avgRating: null,
      logCount: 0,
    })
    expect(r.syncState).toBe('local_only')
    expect(r.createdAt).toBe('2024-01-01T00:00:00Z')
  })

  it('createDish：初始 locked、无避雷、空 tags/stats', () => {
    const d = createDish('rst_1', { name: '水煮牛肉', nameSource: 'user' })
    expect(d.id).toMatch(/^dsh_/)
    expect(d.restaurantId).toBe('rst_1')
    expect(d.status).toBe('locked')
    expect(d.isAvoid).toBe(false)
    expect(d.tags).toEqual([])
    expect(d.prices).toEqual([])
    expect(d.stats.logCount).toBe(0)
  })

  it('createLog：默认 pending、空评论/价格、空 photoIds', () => {
    const l = createLog({
      dishId: 'dsh_1',
      restaurantId: 'rst_1',
      rating: 4.5,
      manualAvoid: false,
      ateAt: '2024-06-01T12:00:00Z',
    })
    expect(l.id).toMatch(/^log_/)
    expect(l.comment).toBe('')
    expect(l.price).toBeNull()
    expect(l.photoIds).toEqual([])
    expect(l.tagExtractionState).toBe('pending')
  })

  it('createPhoto：默认非封面', () => {
    const p = createPhoto({
      refType: 'log',
      refId: 'log_1',
      blobKey: 'idb://blobs/a.jpg',
      width: 1600,
      height: 1200,
      sizeBytes: 1234,
    })
    expect(p.id).toMatch(/^pho_/)
    expect(p.isCover).toBe(false)
  })

  it('createMenuScan：初始 pending', () => {
    const s = createMenuScan({
      restaurantId: 'rst_1',
      sourceImageIds: ['pho_1'],
      isIncremental: false,
    })
    expect(s.id).toMatch(/^scan_/)
    expect(s.status).toBe('pending')
    expect(s.isIncremental).toBe(false)
  })

  it('createDefaultProfile：固定单用户 id=me 与默认偏好', () => {
    const p = createDefaultProfile()
    expect(p.id).toBe('me')
    expect(p.preferences.defaultCardTemplate).toBe('dex_rare')
    expect(p.stats).toEqual({ totalLogs: 0, unlockedDishes: 0, restaurants: 0, streakDays: 0 })
  })
})
