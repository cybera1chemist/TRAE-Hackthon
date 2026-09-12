import { describe, expect, it } from 'vitest'
import {
  canConfirmSave,
  createInitialDraft,
  isDraftFresh,
  pendingLowConfidence,
  scanDraftReducer,
  type ScanDraft,
  type ScanEvent,
} from '@/features/scan-menu'

/** 扫描状态机（T3-01/08 / TDD §3.4：upload→preview→ocr→confirm→saving→done） */

function run(initial: ScanDraft, events: ScanEvent[]): ScanDraft {
  return events.reduce(scanDraftReducer, initial)
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

function dishLine(over: Partial<ScanDraft['lines'][number]> = {}): ScanDraft['lines'][number] {
  return {
    lineKey: `temp-${Math.random()}`,
    section: '招牌菜',
    rawText: '水煮牛肉',
    name: '水煮牛肉',
    price: 58,
    confidence: 0.88,
    kind: 'dish',
    match: { type: 'new' },
    ...over,
  }
}

describe('scanDraftReducer 基本流转', () => {
  it('无图不允许 START_OCR', () => {
    const next = scanDraftReducer(createInitialDraft(), { type: 'START_OCR' })
    expect(next.phase).toBe('upload')
  })

  it('upload → ocr → confirm（OCR_SUCCESS）', () => {
    const next = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      {
        type: 'OCR_SUCCESS',
        lines: [dishLine()],
        unreadable: [{ imageIndex: 0, bbox: { x: 40, y: 900, w: 1000, h: 280 } }],
      },
    ])
    expect(next.phase).toBe('confirm')
    expect(next.lines).toHaveLength(1)
    expect(next.unreadable).toHaveLength(1)
  })

  it('OCR 失败回 preview 且携带归一化错误，可重试（T3-08）', () => {
    const failed = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_FAILURE', error: { code: 'TIMEOUT', retriable: true } },
    ])
    expect(failed.phase).toBe('preview')
    expect(failed.ocrError?.code).toBe('TIMEOUT')
    const retried = run(failed, [{ type: 'START_OCR' }])
    expect(retried.phase).toBe('ocr')
    expect(retried.ocrError).toBeUndefined()
  })

  it('ENTER_MANUAL：失败后降级手录，图片保留（T3-08）', () => {
    const failed = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_FAILURE', error: { code: 'TIMEOUT', retriable: true } },
    ])
    const manual = run(failed, [{ type: 'ENTER_MANUAL' }])
    expect(manual.phase).toBe('confirm')
    expect(manual.images).toHaveLength(1)
    expect(manual.lines).toHaveLength(0)
  })

  it('saving → done；失败回 confirm 带 saveError', () => {
    const confirmed = run(createInitialDraft('r1'), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_SUCCESS', lines: [dishLine({ decision: 'keptSeparate' })] },
      { type: 'START_SAVING' },
    ])
    expect(confirmed.phase).toBe('saving')
    expect(run(confirmed, [{ type: 'SAVE_SUCCESS' }]).phase).toBe('done')
    const failed = run(confirmed, [{ type: 'SAVE_FAILURE', message: 'boom' }])
    expect(failed.phase).toBe('confirm')
    expect(failed.saveError).toBe('boom')
  })
})

describe('保存门禁', () => {
  it('低置信行（<0.5）未决议 → 不允许保存（T3-03 验收）', () => {
    const confirmed = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_SUCCESS', lines: [dishLine({ confidence: 0.41 })] },
    ])
    expect(pendingLowConfidence(confirmed)).toHaveLength(1)
    expect(canConfirmSave(confirmed)).toBe(false)
    const resolved = run(confirmed, [
      { type: 'SET_DECISION', lineKey: confirmed.lines[0].lineKey, decision: 'keptSeparate' },
    ])
    expect(canConfirmSave(resolved)).toBe(true)
  })

  it('手动添加行自带决议（T3-05：无决议不得建菜）', () => {
    const confirmed = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_SUCCESS', lines: [] },
      { type: 'ADD_MANUAL_LINE' },
    ])
    expect(confirmed.lines[0].decision).toBe('keptSeparate')
    expect(confirmed.lines[0].match.type).toBe('new')
  })

  it('非 confirm 阶段 START_SAVING 无效', () => {
    const next = run(createInitialDraft(), [{ type: 'START_SAVING' }])
    expect(next.phase).toBe('upload')
  })
})

describe('回退与草稿', () => {
  it('BACK 只允许后退；从 done 可回 confirm', () => {
    const done = run(createInitialDraft(), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'START_OCR' },
      { type: 'OCR_SUCCESS', lines: [dishLine({ decision: 'keptSeparate' })] },
      { type: 'START_SAVING' },
      { type: 'SAVE_SUCCESS' },
    ])
    expect(run(done, [{ type: 'BACK', to: 'confirm' }]).phase).toBe('confirm')
    // 前进方向的 BACK 无效
    expect(run(createInitialDraft(), [{ type: 'BACK', to: 'confirm' }]).phase).toBe('upload')
  })

  it('isDraftFresh：24h 内可用，过期失效（T3-08）', () => {
    const draft = createInitialDraft()
    const now = Date.parse(draft.updatedAt)
    expect(isDraftFresh(draft, now)).toBe(true)
    expect(isDraftFresh(draft, now + 24 * 3600 * 1000 + 1)).toBe(false)
  })

  it('DISCARD 清空回 upload 但保留店铺', () => {
    const next = run(createInitialDraft('r1'), [
      { type: 'ADD_IMAGES', slots: [slot('a')] },
      { type: 'DISCARD' },
    ])
    expect(next.phase).toBe('upload')
    expect(next.images).toHaveLength(0)
    expect(next.restaurantId).toBe('r1')
  })

  it('SELECT_RESTAURANT 仅在 upload/preview 有效；UPDATE_PRECHECK 就地更新（T3-01）', () => {
    const picked = run(createInitialDraft(), [{ type: 'SELECT_RESTAURANT', restaurantId: 'r9' }])
    expect(picked.restaurantId).toBe('r9')
    // ocr 阶段不允许改店铺
    const inOcr = run(picked, [{ type: 'ADD_IMAGES', slots: [slot('a')] }, { type: 'START_OCR' }])
    expect(run(inOcr, [{ type: 'SELECT_RESTAURANT', restaurantId: 'r10' }]).restaurantId).toBe('r9')

    const withImg = run(createInitialDraft(), [{ type: 'ADD_IMAGES', slots: [slot('a')] }])
    const prechecked = run(withImg, [
      {
        type: 'UPDATE_PRECHECK',
        imageId: 'a',
        precheck: { blur: true, glare: false, tooDark: true },
      },
    ])
    expect(prechecked.images[0].precheck).toEqual({ blur: true, glare: false, tooDark: true })
    // 已删除的图不复活
    const removed = run(prechecked, [{ type: 'REMOVE_IMAGE', imageId: 'a' }])
    expect(
      run(removed, [
        {
          type: 'UPDATE_PRECHECK',
          imageId: 'a',
          precheck: { blur: false, glare: false, tooDark: false },
        },
      ]).images,
    ).toHaveLength(0)
  })
})
