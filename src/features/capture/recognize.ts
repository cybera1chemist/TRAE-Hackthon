/**
 * 识别编排（T2-04 识别侧 / PRD §5.1 流程 A）：
 * - 压缩产物 → dataURL → ai.recognizeDish；
 * - 15s 超时（AI_TIMEOUT_MS.recognize）自动降级手动录入；用户取消走 ABORTED（可重试）；
 * - 识别成功后构建确认行模型：置信三档、Top3 候选、重复项合并（EC-CAP-12）、
 *   已有菜品匹配徽标（EC-CAP-13，matchDish 仅同店）。
 * AI 永不直接写库：此处只产出 UI 行模型，入库由用户确认后 createLogWorkflow 完成。
 */
import { AI_TIMEOUT_MS, type AIProvider, type AIErrorCode, type RecognizeResp } from '@/infra/ai'
import type { Dish, ID } from '@/domain/entities'
import { matchDish, similarity } from '@/domain/services'
import { trackCapture } from './analytics'

export type RecognizeOutcome =
  | { ok: true; resp: RecognizeResp }
  | { ok: false; reason: 'TIMEOUT' | 'ABORTED'; code?: AIErrorCode }

/** 压缩图 → dataURL（BFF/供应商统一消费 dataURL 口径） */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function toDataUrl(image: { blob: ArrayBuffer }): string {
  return `data:image/jpeg;base64,${arrayBufferToBase64(image.blob)}`
}

/**
 * 调 AI 识别：外部 signal 取消 → ABORTED（不判降级）；15s 超时 → TIMEOUT 降级。
 * 其余 AIError/网络错误归入 TIMEOUT 档降级（UI 展示「重试识别 / 手动录入」）。
 */
export async function recognizeDishes(
  ai: Pick<AIProvider, 'recognizeDish'>,
  images: ArrayBuffer[],
  signal: AbortSignal,
  context?: { restaurantId?: string },
): Promise<RecognizeOutcome> {
  const dataUrls = images.map((buffer) => toDataUrl({ blob: buffer }))
  const timer = AbortSignal.timeout(AI_TIMEOUT_MS.recognize)
  const combined = AbortSignal.any([signal, timer])
  trackCapture('recognize_start', { count: dataUrls.length })
  const start = performance.now()
  try {
    const resp = await ai.recognizeDish(
      { images: dataUrls, context: context ? { restaurantId: context.restaurantId } : undefined },
      combined,
    )
    trackCapture('recognize_success', performance.now() - start, { count: dataUrls.length })
    return { ok: true, resp }
  } catch (e) {
    const err = e as Error
    if (signal.aborted) {
      trackCapture('recognize_cancel', performance.now() - start)
      return { ok: false, reason: 'ABORTED' }
    }
    trackCapture('recognize_degraded', performance.now() - start, { err: err.message })
    return { ok: false, reason: 'TIMEOUT', code: (err as { code?: AIErrorCode }).code }
  }
}

// ── 确认行模型（T2-03） ──────────────────────────────────────────────────────

export interface ConfirmDishRow {
  id: string
  selected: boolean
  /** 当前生效菜名（用户可改名） */
  name: string
  nameSource: 'ai' | 'user'
  /** AI 原始识别名（改名后用于 aiSuggestedName 保留） */
  aiName: string
  confidence: number
  candidates: string[]
  /** EC-CAP-13：与同店已有菜品匹配（exact 自动追加 / fuzzy 提示可能同一道菜） */
  match: { dishId: ID; score: number; type: 'exact' | 'fuzzy' | 'new'; logCount: number } | null
  /** EC-CAP-12：被合并进本行的原始名（撤销合并时还原） */
  mergedFrom: string[]
  /** 关联图片槽位下标（保存时映射为照片） */
  photoIdx: number[]
  // 附加信息（T1-07，全部可跳过）
  rating: number | null
  manualAvoid: boolean
  comment: string
  price: number | null
  scene: string
}

let rowSeq = 0
function nextRowId(): string {
  rowSeq += 1
  return `row-${Date.now().toString(36)}-${rowSeq}`
}

/**
 * 识别响应 → 确认行：
 * - 重复菜名相似度 ≥0.9 自动合并为一条（候选并集、置信取最大、图片并集，EC-CAP-12）；
 * - 同店匹配：exact → 默认勾选并挂已有菜（追加打卡）；fuzzy → 提示但不自动挂（EC-CAP-13）；
 * - 默认勾选策略：高置信（≥0.8）勾选；中/低置信不勾（用户显式确认，PRD EC-CAP-11 前提）；
 * - photoIdx 记录菜品来源图片下标（保存时映射为该图的压缩产物）。
 */
export function buildConfirmRows(resp: RecognizeResp, existingDishes: Dish[]): ConfirmDishRow[] {
  const raw = resp.results.flatMap((r) => r.dishes.map((d) => ({ ...d, imgIdx: r.imageIndex })))
  const merged: Array<{
    name: string
    confidence: number
    candidates: string[]
    photoIdx: number[]
    mergedFrom: string[]
  }> = []

  for (const dish of raw) {
    const hit = merged.find((m) => similarity(m.name, dish.name) >= 0.9)
    if (hit) {
      hit.mergedFrom.push(dish.name)
      hit.confidence = Math.max(hit.confidence, dish.confidence)
      if (!hit.photoIdx.includes(dish.imgIdx)) hit.photoIdx.push(dish.imgIdx)
      for (const c of dish.candidates) if (!hit.candidates.includes(c)) hit.candidates.push(c)
      continue
    }
    merged.push({
      name: dish.name,
      confidence: dish.confidence,
      candidates: [...dish.candidates],
      photoIdx: [dish.imgIdx],
      mergedFrom: [],
    })
  }

  return merged.map((m) => {
    const match = matchOf(m.name, existingDishes)
    return {
      id: nextRowId(),
      selected: m.confidence >= 0.8,
      name: m.name,
      nameSource: 'ai' as const,
      aiName: m.name,
      confidence: m.confidence,
      candidates: m.candidates.slice(0, 3),
      match:
        match && match.dishId
          ? {
              dishId: match.dishId,
              score: match.score,
              type: match.type,
              logCount: logCountOf(match.dishId, existingDishes),
            }
          : null,
      mergedFrom: m.mergedFrom,
      photoIdx: m.photoIdx,
      rating: null,
      manualAvoid: false,
      comment: '',
      price: null,
      scene: '',
    }
  })
}

function matchOf(name: string, existing: Dish[]) {
  const r = matchDish({ name }, existing)
  if (!r.dishId) return null
  return { dishId: r.dishId, score: r.score, type: r.type }
}

/** 行菜名变化（改名/换候选）后重算同店匹配（EC-CAP-13） */
export function recomputeMatches(rows: ConfirmDishRow[], dishes: Dish[]): ConfirmDishRow[] {
  return rows.map((r) => {
    const m = matchOf(r.name, dishes)
    return {
      ...r,
      match:
        m && m.dishId
          ? {
              dishId: m.dishId,
              score: m.score,
              type: m.type,
              logCount: logCountOf(m.dishId, dishes),
            }
          : null,
    }
  })
}

function logCountOf(dishId: ID, dishes: Dish[]): number {
  return dishes.find((d) => d.id === dishId)?.stats.logCount ?? 0
}

/** 手添行（EC-CAP-10/14：0 识别或全部取消时的兜底入口） */
export function createManualRow(name: string, photoIdx: number[] = []): ConfirmDishRow {
  return {
    id: nextRowId(),
    selected: true,
    name,
    nameSource: 'user',
    aiName: '',
    confidence: 1,
    candidates: [],
    match: null,
    mergedFrom: [],
    photoIdx,
    rating: null,
    manualAvoid: false,
    comment: '',
    price: null,
    scene: '',
  }
}

/** 草稿恢复行（T1-07：24h 内恢复，识别态视为降级手动录入） */
export function draftToRows(
  dishes: Array<Partial<ConfirmDishRow> & { name: string }>,
): ConfirmDishRow[] {
  return dishes.map((d) => ({ ...createManualRow(d.name), selected: false, ...d, id: nextRowId() }))
}

/** EC-CAP-14：全部取消勾选时主按钮文案 */
export function saveButtonLabel(rows: ConfirmDishRow[]): string {
  const anySelected = rows.some((r) => r.selected)
  return anySelected ? '保存打卡' : '仅保存图片（不打卡菜品）'
}
