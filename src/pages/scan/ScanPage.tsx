import { useCallback, useReducer } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/ui'
import { createMockAIProvider, type AIErrorCode } from '@/infra/ai'
import {
  canConfirmSave,
  createInitialDraft,
  pendingLowConfidence,
  scanDraftReducer,
  toLineDrafts,
  validateImageFiles,
  type MenuLineDraft,
  type ScanImageSlot,
} from '@/features/scan-menu'

/**
 * /scan/:rid? 页面骨架（T3-01/03 prep harness）。
 * 当前仅打通 状态机 + Mock OCR 全链路，供开发自测：
 * - 预检像素级分析待 image worker（Agent-3）提供 decode 后接入本 feature 纯函数；
 * - 匹配列与保存落库待 Agent-1 matcher.ts + DishRepo.upsertFromOcr 真实现后接线（TODO(T3-04/05)）；
 * - 增量扫描历史 diff 由 computeMenuDiff 在 OCR_SUCCESS 前计算（TODO(T3-06)）。
 */

function makeSlot(file: File): ScanImageSlot {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    previewUrl: URL.createObjectURL(file),
    sizeBytes: file.size,
    fileName: file.name,
    precheck: { blur: false, glare: false, tooDark: false },
    rotation: 0,
  }
}

/** 置信度色档（PRD EC-MENU：<0.5 强制处理 / 0.5–0.8 关注 / 其余正常） */
function lineTone(line: MenuLineDraft): string {
  if (line.kind !== 'dish') return 'text-ink-muted'
  if (line.confidence < 0.5) return 'text-avoid'
  if (line.confidence < 0.8) return 'text-gold'
  return 'text-ink-muted'
}

export function Component() {
  const { rid } = useParams()
  const [draft, dispatch] = useReducer(scanDraftReducer, undefined, () => createInitialDraft(rid))

  const onPickFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    const all = Array.from(files)
    const metas = all.map((f) => ({ name: f.name, type: f.type, size: f.size }))
    const validations = validateImageFiles(metas, 0)
    const slots = validations.filter((v) => v.ok).map((v) => makeSlot(all[v.index]))
    if (slots.length > 0) dispatch({ type: 'ADD_IMAGES', slots })
  }, [])

  const onStartOcr = useCallback(async () => {
    dispatch({ type: 'START_OCR' })
    const ai = createMockAIProvider()
    try {
      // TODO(T3-04): images 走 fileToBase64；匹配接 Agent-1 matcher 后为每行补 matchResult
      const resp = await ai.scanMenu({ images: [], restaurantId: rid })
      const { lines, unreadable } = toLineDrafts(resp)
      dispatch({ type: 'OCR_SUCCESS', lines, unreadable })
    } catch (err) {
      const error = err as { code?: AIErrorCode; retriable?: boolean; message?: string }
      dispatch({
        type: 'OCR_FAILURE',
        error: {
          code: error.code ?? 'UNKNOWN',
          retriable: error.retriable ?? false,
          message: error.message,
        },
      })
    }
  }, [rid])

  const pending = pendingLowConfidence(draft)

  return (
    <div className="min-h-dvh bg-bg p-4 pb-24 text-ink">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">菜单扫描</h1>
        <span className="text-xs text-ink-muted">
          {draft.isIncremental ? '增量模式' : '首扫'} · {draft.phase}
        </span>
      </header>

      {draft.phase !== 'confirm' && draft.phase !== 'saving' && draft.phase !== 'done' && (
        <section className="space-y-3">
          <label className="block cursor-pointer rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm">
            拍照 / 选择菜单图片（≤10 张，单张 ≤10MB）
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </label>
          <ul className="grid grid-cols-3 gap-2">
            {draft.images.map((img) => (
              <li key={img.id} className="relative overflow-hidden rounded-lg border border-line">
                <img
                  src={img.previewUrl}
                  alt={img.fileName}
                  style={{ transform: `rotate(${img.rotation}deg)` }}
                  className="aspect-[3/4] w-full object-cover"
                />
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded bg-black/60 px-1 text-xs text-white"
                  onClick={() => dispatch({ type: 'REMOVE_IMAGE', imageId: img.id })}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-xs text-white"
                  onClick={() => dispatch({ type: 'ROTATE_IMAGE', imageId: img.id })}
                >
                  旋转
                </button>
              </li>
            ))}
          </ul>
          {draft.ocrError && (
            <p className="text-sm text-avoid">
              识别失败（{draft.ocrError.code}），可重试或改为手录。
            </p>
          )}
          <Button
            className="w-full"
            disabled={draft.images.length === 0}
            onClick={() => void onStartOcr()}
          >
            开始识别
          </Button>
        </section>
      )}

      {(draft.phase === 'confirm' || draft.phase === 'saving') && (
        <section className="space-y-3">
          {pending.length > 0 && (
            <p className="rounded-lg border border-avoid/40 bg-avoid/10 p-2 text-sm text-avoid">
              {pending.length} 行低置信（&lt;0.5）需逐行确认后才能保存。
            </p>
          )}
          <ul className="space-y-2">
            {draft.lines.map((line) => (
              <li
                key={line.lineKey}
                className="rounded-lg border border-line bg-surface p-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={line.name}
                    aria-label="菜名"
                    className="min-w-0 flex-1 bg-transparent outline-none"
                    onChange={(e) =>
                      dispatch({
                        type: 'EDIT_LINE',
                        lineKey: line.lineKey,
                        patch: { name: e.target.value },
                      })
                    }
                  />
                  <span className={lineTone(line)}>
                    {line.confidence.toFixed(2)}
                    {line.kind !== 'dish' ? ' · 其他' : ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-muted">
                  <span>
                    {line.section}
                    {line.spec ? ` / ${line.spec}` : ''}
                    {line.price != null ? ` / ¥${line.price}` : ''}
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'DELETE_LINE', lineKey: line.lineKey })}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'SET_DECISION',
                          lineKey: line.lineKey,
                          decision: 'keptSeparate',
                        })
                      }
                    >
                      保留
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          type: 'SET_DECISION',
                          lineKey: line.lineKey,
                          decision: 'ignored',
                        })
                      }
                    >
                      忽略
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => dispatch({ type: 'ADD_MANUAL_LINE' })}
          >
            手动添加一行
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => dispatch({ type: 'BACK', to: 'preview' })}
            >
              返回重扫
            </Button>
            {/* TODO(T3-05): START_SAVING 后调 workflow：DishRepo.upsertFromOcr(toResolvedItems(draft)) */}
            <Button
              className="flex-1"
              disabled={!canConfirmSave(draft)}
              onClick={() => {
                dispatch({ type: 'START_SAVING' })
                dispatch({ type: 'SAVE_SUCCESS' })
              }}
            >
              保存到图鉴
            </Button>
          </div>
        </section>
      )}

      {draft.phase === 'done' && (
        <section className="space-y-4 text-center">
          <p className="text-sm">已保存（prep harness：实际落库待 DishRepo 真实现）。</p>
          <Button onClick={() => dispatch({ type: 'DISCARD' })}>再扫一次</Button>
        </section>
      )}
    </div>
  )
}
