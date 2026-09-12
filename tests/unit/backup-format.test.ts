import { describe, expect, it } from 'vitest'
import {
  BACKUP_APP,
  MAX_VOLUME_BYTES,
  previewImport,
  suggestVolumeCount,
  validateBackupPackage,
  type BackupPackage,
} from '@/infra/backup/format'
import { createDish, createLog, createRestaurant } from '@/domain/factories'
import type { Dish, Restaurant } from '@/domain/entities'

const NOW = '2024-06-01T00:00:00Z'

function restaurant(id: string, name: string): Restaurant {
  return { ...createRestaurant({ name }, NOW), id }
}

function dish(rid: string, id: string, name: string, aliases: string[] = []): Dish {
  return { ...createDish(rid, { name, nameSource: 'ocr', aliases }), id }
}

function pkg(partial: Partial<BackupPackage> = {}): BackupPackage {
  return {
    app: BACKUP_APP,
    schemaVersion: 1,
    exportedAt: NOW,
    photos: 'none',
    data: {
      userProfile: [],
      restaurants: [],
      dishes: [],
      logs: [],
      photos: [],
      tagVocab: [],
      menuScans: [],
      ocrItems: [],
    },
    ...partial,
  }
}

describe('validateBackupPackage', () => {
  it('合法包通过', () => {
    expect(validateBackupPackage(pkg())).toEqual({ ok: true })
  })
  it.each([null, undefined, 1, 'x', []])('非对象拒绝：%s', (v) => {
    expect(validateBackupPackage(v).ok).toBe(false)
  })
  it('app 不匹配拒绝', () => {
    const r = validateBackupPackage(pkg({ app: 'other' as BackupPackage['app'] }))
    expect(r).toMatchObject({ ok: false })
  })
  it('高版本备份拒绝（防降级误导入）', () => {
    const r = validateBackupPackage(pkg({ schemaVersion: 999 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('升级应用')
  })
  it('缺 data / 非法版本拒绝', () => {
    expect(validateBackupPackage(pkg({ data: null as unknown as BackupPackage['data'] })).ok).toBe(
      false,
    )
    expect(validateBackupPackage(pkg({ schemaVersion: 0 })).ok).toBe(false)
  })
})

describe('suggestVolumeCount', () => {
  it('0 → 0；首卷即算 1；按 50MB 向上取整', () => {
    expect(suggestVolumeCount(0)).toBe(0)
    expect(suggestVolumeCount(1)).toBe(1)
    expect(suggestVolumeCount(MAX_VOLUME_BYTES)).toBe(1)
    expect(suggestVolumeCount(MAX_VOLUME_BYTES + 1)).toBe(2)
  })
})

describe('previewImport 冲突矩阵', () => {
  it('同名店铺 + 同名菜 → merge/exact；新菜 → new', () => {
    const existing = {
      restaurants: [restaurant('rst_old', '川香小馆')],
      dishes: [dish('rst_old', 'dsh_old', '宫保鸡丁')],
    }
    const backup = pkg({
      data: {
        ...pkg().data,
        restaurants: [restaurant('rst_in', '川香小馆'), restaurant('rst_in2', '新店')],
        dishes: [
          dish('rst_in', 'dsh_in1', '宫保鸡丁'),
          dish('rst_in', 'dsh_in2', '宫保鸡丁饭'),
          dish('rst_in2', 'dsh_in3', '沙拉'),
        ],
        logs: [
          createLog({
            dishId: 'dsh_in1',
            restaurantId: 'rst_in',
            rating: 5,
            manualAvoid: false,
            ateAt: NOW,
          }),
        ],
        photos: [],
      },
    })

    const preview = previewImport(backup, existing)
    expect(preview.restaurants).toEqual([
      expect.objectContaining({ incomingId: 'rst_in', action: 'merge', existingId: 'rst_old' }),
      expect.objectContaining({ incomingId: 'rst_in2', action: 'create' }),
    ])
    const byIncoming = new Map(preview.dishes.map((c) => [c.incomingId, c]))
    expect(byIncoming.get('dsh_in1')).toMatchObject({ type: 'exact', existingDishId: 'dsh_old' })
    expect(byIncoming.get('dsh_in1')?.userDecisionRequired).toBe(false)
    expect(byIncoming.get('dsh_in2')?.type).toBe('fuzzy')
    expect(byIncoming.get('dsh_in2')?.userDecisionRequired).toBe(true)
    expect(byIncoming.get('dsh_in3')?.type).toBe('new')
    expect(preview.requiresDecision).toBe(1)
    expect(preview.stats).toMatchObject({
      restaurantsToCreate: 1,
      dishesToMerge: 1,
      logs: 1,
    })
  })

  it('跨店同名菜不算冲突（匹配只在同店内进行）', () => {
    const existing = {
      restaurants: [restaurant('rst_a', '甲店'), restaurant('rst_b', '乙店')],
      dishes: [dish('rst_a', 'd1', '宫保鸡丁')],
    }
    const backup = pkg({
      data: {
        ...pkg().data,
        restaurants: [restaurant('ri_b', '乙店')],
        dishes: [dish('ri_b', 'di1', '宫保鸡丁')],
      },
    })
    const preview = previewImport(backup, existing)
    // 乙店在库中存在但无宫保鸡丁 → 同店内无候选 → new
    expect(preview.dishes[0]).toMatchObject({ type: 'new' })
  })
})
