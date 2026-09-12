import { describe, expect, it } from 'vitest'
import {
  createInitialDraft,
  groupMenuLines,
  OTHER_GROUP_TITLE,
  scanDraftReducer,
  toLineDrafts,
  type MenuLineDraft,
  type ScanEvent,
  type UnreadableRegion,
} from '@/features/scan-menu'
import type { MenuScanResp } from '@/infra/ai'

/** T3-03 确认页：框选重扫合并（EC-MENU-04）+ 分区分组（其他折叠区）+ imageIndex 追踪 */

function line(over: Partial<MenuLineDraft> & { name: string }): MenuLineDraft {
  return {
    lineKey: `l-${Math.random().toString(36).slice(2)}`,
    section: '招牌菜',
    rawText: over.name,
    price: 10,
    confidence: 0.9,
    kind: 'dish',
    match: { type: 'new' },
    decision: 'keptSeparate',
    ...over,
  }
}

function slot(id: string) {
  return {
    id,
    previewUrl: `blob:${id}`,
    sizeBytes: 1000,
    fileName: `${id}.jpg`,
    precheck: { blur: false, glare: false, tooDark: false },
    rotation: 0 as const,
  }
}

function toConfirm(
  lines: MenuLineDraft[],
  unreadable: UnreadableRegion[] = [],
): ReturnType<typeof scanDraftReducer> {
  const events: ScanEvent[] = [
    { type: 'ADD_IMAGES', slots: [slot('a'), slot('b')] },
    { type: 'START_OCR' },
    { type: 'OCR_SUCCESS', lines, unreadable },
  ]
  return events.reduce(scanDraftReducer, createInitialDraft())
}

describe('RESCAN_MERGE（框选重扫合并）', () => {
  const regionA = { x: 0, y: 0, w: 100, h: 40 }
  const farB = { x: 0, y: 500, w: 100, h: 40 }

  it('同图重叠行被替换；不重叠行与跨图行保留；新行带 rescanOf/imageIndex', () => {
    const a = line({ name: '水煮牛肉', imageIndex: 0, bbox: regionA })
    const b = line({ name: '歌乐山辣子鸡', imageIndex: 0, bbox: farB })
    const c = line({ name: '麻婆豆腐', imageIndex: 1, bbox: regionA })
    const merged = scanDraftReducer(toConfirm([a, b, c]), {
      type: 'RESCAN_MERGE',
      imageIndex: 0,
      region: { x: 0, y: 0, w: 100, h: 60 }, // 覆盖 regionA 全部
      lines: [line({ name: '水煮牛肉（重扫）', imageIndex: 0, bbox: regionA, rescanOf: regionA })],
      unreadable: [],
    })

    const names = merged.lines.map((l) => l.name)
    expect(names).toContain('水煮牛肉（重扫）')
    expect(names).toContain('歌乐山辣子鸡')
    expect(names).toContain('麻婆豆腐')
    expect(names).not.toContain('水煮牛肉')

    const rescanned = merged.lines.find((l) => l.rescanOf != null)
    expect(rescanned?.imageIndex).toBe(0)
    expect(rescanned?.rescanOf).toEqual(regionA)
  })

  it('不可读区：同图重叠区被清除，跨图区保留，重扫返回区映射到目标图', () => {
    const unreadable = [
      { imageIndex: 0, bbox: { x: 40, y: 900, w: 1000, h: 280 } },
      { imageIndex: 1, bbox: { x: 40, y: 900, w: 1000, h: 280 } },
    ]
    const merged = scanDraftReducer(toConfirm([], unreadable), {
      type: 'RESCAN_MERGE',
      imageIndex: 0,
      region: { x: 0, y: 850, w: 1100, h: 400 },
      lines: [],
      unreadable: [{ imageIndex: 0, bbox: { x: 40, y: 950, w: 500, h: 120 } }],
    })

    expect(merged.unreadable).toHaveLength(2)
    expect(merged.unreadable.filter((u) => u.imageIndex === 0)).toEqual([
      { imageIndex: 0, bbox: { x: 40, y: 950, w: 500, h: 120 } },
    ])
    expect(merged.unreadable.filter((u) => u.imageIndex === 1)).toEqual([
      { imageIndex: 1, bbox: { x: 40, y: 900, w: 1000, h: 280 } },
    ])
  })

  it('可携带 diffSummary 更新增量摘要；非 confirm 阶段无效', () => {
    const merged = scanDraftReducer(toConfirm([line({ name: '水煮牛肉' })]), {
      type: 'RESCAN_MERGE',
      imageIndex: 0,
      region: { x: 0, y: 0, w: 100, h: 40 },
      lines: [],
      unreadable: [],
      diffSummary: { added: 2, removed: 1, renamed: 0 },
    })
    expect(merged.diffSummary).toEqual({ added: 2, removed: 1, renamed: 0 })

    // 非 confirm：upload 态直接 RESCAN_MERGE 无效
    const untouched = scanDraftReducer(createInitialDraft(), {
      type: 'RESCAN_MERGE',
      imageIndex: 0,
      region: { x: 0, y: 0, w: 100, h: 40 },
      lines: [line({ name: '不该出现' })],
      unreadable: [],
    })
    expect(untouched.lines).toHaveLength(0)
  })
})

describe('groupMenuLines（分区分组，EC-MENU-04）', () => {
  it('菜品按分区聚簇保持首现顺序，空分区归「未分区」，非菜品归「其他」', () => {
    const groups = groupMenuLines([
      line({ name: '水煮牛肉', section: '招牌菜' }),
      line({ name: '凉拌黄瓜', section: '凉菜' }),
      line({ name: '歌乐山辣子鸡', section: '招牌菜' }),
      line({ name: '无分区菜', section: '' }),
      line({ name: '青岛啤酒', kind: 'drink', section: '酒水' }),
      line({ name: '茶位费', kind: 'fee', section: '其他' }),
    ])

    expect(groups.map((g) => g.title)).toEqual(['招牌菜', '凉菜', '未分区', OTHER_GROUP_TITLE])
    expect(groups.map((g) => g.kind)).toEqual(['section', 'section', 'section', 'other'])
    expect(groups[0].lines.map((l) => l.name)).toEqual(['水煮牛肉', '歌乐山辣子鸡'])
    expect(groups[3].lines.map((l) => l.kind)).toEqual(['drink', 'fee'])
  })

  it('无非菜品行时不产生「其他」分组', () => {
    const groups = groupMenuLines([line({ name: '水煮牛肉' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('section')
  })
})

describe('toLineDrafts imageIndex 追踪（框选重扫依赖）', () => {
  it('每行记录来源图下标，不可读区块按图收集', () => {
    const resp: MenuScanResp = {
      requestId: 'req-1',
      model: { vendor: 'mock', version: 'v1' },
      results: [
        {
          imageIndex: 0,
          unreadableRegions: [[40, 900, 1000, 1100]],
          sections: [
            {
              name: '招牌菜',
              items: [{ name: '水煮牛肉', price: 58, confidence: 0.9, bbox: [10, 20, 300, 60] }],
            },
          ],
        },
        {
          imageIndex: 1,
          unreadableRegions: [],
          sections: [
            {
              name: '凉菜',
              items: [{ name: '凉拌黄瓜', price: 12, confidence: 0.85, bbox: [10, 100, 200, 40] }],
            },
          ],
        },
      ],
    }
    const { lines, unreadable } = toLineDrafts(resp)
    expect(lines.map((l) => [l.name, l.imageIndex])).toEqual([
      ['水煮牛肉', 0],
      ['凉拌黄瓜', 1],
    ])
    expect(unreadable).toEqual([{ imageIndex: 0, bbox: { x: 40, y: 900, w: 960, h: 200 } }])
  })
})
