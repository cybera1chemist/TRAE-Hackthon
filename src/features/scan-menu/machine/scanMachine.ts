/**
 * 扫描页状态机（T3-01/08 / TDD §3.4）：upload→preview→ocr→confirm→saving→done。
 * 纯 reducer，无副作用；草稿全程驻留（退出恢复时用 RESTORE_DRAFT + isDraftFresh）。
 * 超时/失败语义：OCR 失败回 preview 可重试，完全失败可手录（T3-08）。
 */
import type { ID, OcrUserDecision, ScanDiffSummary } from '@/domain/entities'
import type {
  MenuLineDraft,
  ScanDraft,
  ScanImageSlot,
  ScanOcrError,
  ScanPhase,
  UnreadableRegion,
} from '../types'

const PHASE_ORDER: readonly ScanPhase[] = ['upload', 'preview', 'ocr', 'confirm', 'saving', 'done']

export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type ScanEvent =
  | { type: 'RESTORE_DRAFT'; draft: ScanDraft }
  | { type: 'SELECT_RESTAURANT'; restaurantId: ID }
  | { type: 'ADD_IMAGES'; slots: ScanImageSlot[] }
  | { type: 'REMOVE_IMAGE'; imageId: ID }
  | { type: 'ROTATE_IMAGE'; imageId: ID }
  | { type: 'START_OCR' }
  | {
      type: 'OCR_SUCCESS'
      lines: MenuLineDraft[]
      unreadable?: UnreadableRegion[]
      isIncremental?: boolean
      diffSummary?: ScanDiffSummary
    }
  | { type: 'OCR_FAILURE'; error: ScanOcrError }
  | {
      type: 'EDIT_LINE'
      lineKey: string
      patch: Partial<Pick<MenuLineDraft, 'name' | 'price' | 'spec' | 'section'>>
    }
  | { type: 'SET_DECISION'; lineKey: string; decision: OcrUserDecision }
  | { type: 'DELETE_LINE'; lineKey: string }
  | { type: 'ADD_MANUAL_LINE'; section?: string }
  | { type: 'START_SAVING' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_FAILURE'; message: string }
  | { type: 'BACK'; to: ScanPhase }
  | { type: 'DISCARD' }

let manualSeq = 0

export function createInitialDraft(restaurantId?: ID): ScanDraft {
  return {
    restaurantId,
    phase: 'upload',
    images: [],
    lines: [],
    unreadable: [],
    isIncremental: false,
    updatedAt: new Date().toISOString(),
  }
}

function patchLine(
  lines: MenuLineDraft[],
  lineKey: string,
  fn: (line: MenuLineDraft) => MenuLineDraft,
): MenuLineDraft[] {
  return lines.map((l) => (l.lineKey === lineKey ? fn(l) : l))
}

/** 低置信行（<0.5）必须处理才能保存（T3-03 验收） */
export function pendingLowConfidence(draft: ScanDraft): MenuLineDraft[] {
  return draft.lines.filter((l) => l.kind === 'dish' && l.confidence < 0.5 && l.decision == null)
}

/** 所有 dish 行是否都有决议（drink/fee 由 applyDefaultDecisions 兜底，不阻塞） */
export function canConfirmSave(draft: ScanDraft): boolean {
  if (draft.phase !== 'confirm') return false
  return draft.lines
    .filter((l) => l.kind === 'dish')
    .every((l) => l.decision != null && l.decision !== 'deleted')
}

/** 草稿是否仍可用（T3-08：默认 24h 过期） */
export function isDraftFresh(
  draft: ScanDraft,
  nowMs: number,
  maxAgeMs = DRAFT_MAX_AGE_MS,
): boolean {
  const updated = Date.parse(draft.updatedAt)
  if (Number.isNaN(updated)) return false
  return nowMs - updated <= maxAgeMs
}

export function scanDraftReducer(state: ScanDraft, event: ScanEvent): ScanDraft {
  const base: ScanDraft = { ...state, updatedAt: new Date().toISOString() }

  switch (event.type) {
    case 'RESTORE_DRAFT':
      return event.draft

    case 'SELECT_RESTAURANT': {
      if (state.phase !== 'upload' && state.phase !== 'preview') return state
      return { ...base, restaurantId: event.restaurantId }
    }

    case 'ADD_IMAGES': {
      if (state.phase !== 'upload' && state.phase !== 'preview') return state
      return { ...base, images: [...state.images, ...event.slots], ocrError: undefined }
    }

    case 'REMOVE_IMAGE': {
      if (state.phase !== 'upload' && state.phase !== 'preview') return state
      return { ...base, images: state.images.filter((img) => img.id !== event.imageId) }
    }

    case 'ROTATE_IMAGE': {
      return {
        ...base,
        images: state.images.map((img) =>
          img.id === event.imageId
            ? { ...img, rotation: ((img.rotation + 90) % 360) as ScanImageSlot['rotation'] }
            : img,
        ),
      }
    }

    case 'START_OCR': {
      if (state.images.length === 0) return state
      if (state.phase !== 'upload' && state.phase !== 'preview') return state
      return { ...base, phase: 'ocr' as const, ocrError: undefined }
    }

    case 'OCR_SUCCESS': {
      if (state.phase !== 'ocr') return state
      return {
        ...base,
        phase: 'confirm' as const,
        lines: event.lines,
        unreadable: event.unreadable ?? [],
        isIncremental: event.isIncremental ?? state.isIncremental,
        diffSummary: event.diffSummary,
      }
    }

    case 'OCR_FAILURE': {
      if (state.phase !== 'ocr') return state
      return { ...base, phase: 'preview' as const, ocrError: event.error }
    }

    case 'EDIT_LINE': {
      if (state.phase !== 'confirm') return state
      return {
        ...base,
        lines: patchLine(state.lines, event.lineKey, (l) => ({ ...l, ...event.patch })),
      }
    }

    case 'SET_DECISION': {
      if (state.phase !== 'confirm') return state
      return {
        ...base,
        lines: patchLine(state.lines, event.lineKey, (l) => ({ ...l, decision: event.decision })),
      }
    }

    case 'DELETE_LINE': {
      if (state.phase !== 'confirm') return state
      return {
        ...base,
        lines: patchLine(state.lines, event.lineKey, (l) => ({ ...l, decision: 'deleted' })),
      }
    }

    case 'ADD_MANUAL_LINE': {
      if (state.phase !== 'confirm') return state
      manualSeq += 1
      const line: MenuLineDraft = {
        lineKey: `temp-manual-${Date.now()}-${manualSeq}`,
        section: event.section ?? '',
        rawText: '',
        name: '',
        price: null,
        confidence: 1,
        kind: 'dish',
        match: { type: 'new' },
        decision: 'keptSeparate', // 手动添加视为用户已决议（T3-05）
      }
      return { ...base, lines: [...state.lines, line] }
    }

    case 'START_SAVING': {
      if (state.phase !== 'confirm' || !canConfirmSave(state)) return state
      return { ...base, phase: 'saving' as const, saveError: undefined }
    }

    case 'SAVE_SUCCESS': {
      if (state.phase !== 'saving') return state
      return { ...base, phase: 'done' as const }
    }

    case 'SAVE_FAILURE': {
      if (state.phase !== 'saving') return state
      return { ...base, phase: 'confirm' as const, saveError: event.message }
    }

    case 'BACK': {
      if (PHASE_ORDER.indexOf(event.to) >= PHASE_ORDER.indexOf(state.phase)) return state
      return { ...base, phase: event.to }
    }

    case 'DISCARD':
      return createInitialDraft(state.restaurantId)

    default:
      return state
  }
}
