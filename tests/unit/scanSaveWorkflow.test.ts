import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '@/infra/db/__inmemory__'
import type { ScanDraft } from '@/features/scan-menu'
import { saveScan } from '@/features/scan-menu'
import type { MenuLineDraft } from '@/features/scan-menu'

/**
 * 扫描保存 workflow（T3-05/08）：
 * 图片 BlobStore→Photo(scan)→MenuScan.sourceImageIds；OcrItem 全量落库+决议回写；
 * 决议行 upsertFromOcr（exact/fuzzy-merged 关联、new 建灰菜、ignored 不建菜）；
 * EC-MENU-05 removed 仅用户确认才物理删除。
 */

function line(over: Partial<MenuLineDraft> & { name: string }): MenuLineDraft {
  return {
    lineKey: `temp-${over.name}`,
    section: '招牌菜',
    rawText: over.name,
    price: 38,
    confidence: 0.9,
    kind: 'dish',
    match: { type: 'new' },
    ...over,
  }
}

function draftFixture(over: Partial<ScanDraft> = {}): ScanDraft {
  return {
    restaurantId: 'r1',
    phase: 'saving',
    images: [],
    lines: [],
    unreadable: [],
    isIncremental: false,
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

function imageFile(name = 'menu.jpg'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/jpeg' })
}

describe('saveScan workflow', () => {
  let ctx: ReturnType<typeof createInMemoryRepositories>
  beforeEach(() => {
    ctx = createInMemoryRepositories()
  })

  it('全量保存：图片/Photo/OcrItem/菜品提升/scan 置 confirmed', async () => {
    const { repos, blobStore } = ctx
    const r = await repos.restaurants.create({ name: '川香小馆' })
    const d1 = await repos.dishes.create(r.id, { name: '水煮牛肉', nameSource: 'ocr' })
    const d2 = await repos.dishes.create(r.id, { name: '歌乐山辣子鸡', nameSource: 'ocr' })

    const draft = draftFixture({
      restaurantId: r.id,
      isIncremental: true,
      diffSummary: { added: 1, removed: 0, renamed: 0 },
      lines: [
        // exact 自动关联（同名）
        line({
          name: '水煮牛肉',
          match: { type: 'exact', dishId: d1.id, score: 1 },
          decision: 'linked',
        }),
        // fuzzy 用户确认合并 → 关联不新建
        line({
          name: '歌乐山辣子鸡（微辣）',
          match: { type: 'fuzzy', dishId: d2.id, score: 0.86 },
          decision: 'merged',
        }),
        // 新菜
        line({ name: '麻婆豆腐', match: { type: 'new' }, decision: 'keptSeparate' }),
        // 酒水行默认 ignored，不建菜
        line({ name: '青岛啤酒', kind: 'drink', match: { type: 'ignored' } }),
      ],
    })

    const result = await saveScan(
      { repos, blobStore },
      {
        draft,
        images: [{ imageId: 'img1', file: imageFile(), width: 1600, height: 1200 }],
      },
    )

    expect(result.createdDishIds).toHaveLength(1)
    expect(result.linkedDishIds.sort()).toEqual([d1.id, d2.id].sort())

    // MenuScan：confirmed + diffSummary + sourceImageIds
    const scans = await repos.menuScans.listByRestaurant(r.id)
    expect(scans).toHaveLength(1)
    const scan = scans[0]
    expect(scan.status).toBe('confirmed')
    expect(scan.isIncremental).toBe(true)
    expect(scan.diffSummary).toEqual({ added: 1, removed: 0, renamed: 0 })
    expect(scan.confirmedAt).toBeDefined()
    expect(scan.sourceImageIds).toHaveLength(1)

    // Photo(refType='scan') + Blob 本体可读
    const photo = await repos.photos.get(scan.sourceImageIds[0])
    expect(photo).toMatchObject({ refType: 'scan', refId: scan.id, width: 1600, height: 1200 })
    await expect(blobStore.get(photo!.blobKey)).resolves.toBeDefined()

    // OcrItem 全量落库（4 行，含 ignored 酒水）+ 决议回写
    const items = await repos.menuScans.listOcrItems(scan.id)
    expect(items).toHaveLength(4)
    const decisions = items.map((o) => o.userDecision)
    expect(decisions).toContain('linked')
    expect(decisions).toContain('merged')
    expect(decisions).toContain('keptSeparate')
    expect(decisions).toContain('ignored')

    // 菜品：新建 1 道灰菜；合并行未新建
    const dishes = await repos.dishes.listByRestaurant(r.id)
    expect(dishes.map((d) => d.name).sort()).toEqual(
      ['歌乐山辣子鸡', '水煮牛肉', '麻婆豆腐'].sort(),
    )
    // fuzzy merged 的 OCR 名只作建议，不覆盖现名（EC-MENU-06）
    const merged = dishes.find((d) => d.id === d2.id)
    expect(merged?.name).toBe('歌乐山辣子鸡')
    expect(merged?.aiSuggestedName).toBe('歌乐山辣子鸡（微辣）')
  })

  it('手录模式（无图片）：无 Photo/无 sourceImageIds，菜品照常提升', async () => {
    const { repos, blobStore } = ctx
    const r = await repos.restaurants.create({ name: 'A' })
    const draft = draftFixture({
      restaurantId: r.id,
      lines: [line({ name: '手录菜', decision: 'keptSeparate' })],
    })
    const result = await saveScan({ repos, blobStore }, { draft, images: [] })
    expect(result.createdDishIds).toHaveLength(1)
    const scans = await repos.menuScans.listByRestaurant(r.id)
    expect(scans[0].sourceImageIds).toEqual([])
    expect((await repos.dishes.listByRestaurant(r.id)).map((d) => d.name)).toEqual(['手录菜'])
  })

  it('EC-MENU-05：removed 默认保留；用户确认的才物理删除', async () => {
    const { repos, blobStore } = ctx
    const r = await repos.restaurants.create({ name: 'B' })
    const gone = await repos.dishes.create(r.id, { name: '已下架菜', nameSource: 'ocr' })
    const draft = draftFixture({
      restaurantId: r.id,
      lines: [line({ name: '新菜', decision: 'keptSeparate' })],
    })

    // 未确认 → 保留
    await saveScan({ repos, blobStore }, { draft, images: [] })
    expect(await repos.dishes.get(gone.id)).toBeDefined()

    // 确认删除 → 级联删除
    const result = await saveScan(
      { repos, blobStore },
      { draft, images: [], confirmedRemovedDishIds: [gone.id] },
    )
    expect(result.removedDishIds).toEqual([gone.id])
    expect(await repos.dishes.get(gone.id)).toBeUndefined()
  })

  it('缺店铺 → 抛错（页面层 SAVE_FAILURE 回 confirm）', async () => {
    const { repos, blobStore } = ctx
    await expect(
      saveScan(
        { repos, blobStore },
        { draft: draftFixture({ restaurantId: undefined }), images: [] },
      ),
    ).rejects.toThrow(/店铺/)
  })
})
