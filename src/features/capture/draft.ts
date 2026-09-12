/**
 * 打卡草稿（T1-07 / PRD §5.1 流程规则）：确认页之前的退出保留草稿 24 小时。
 *
 * 存储口径：
 * - localStorage（轻量文本态；图片二进制不入草稿，重新进入从拍照步骤开始）；
 * - 保存时打 savedAt 时间戳，读取时超 24h 视为过期并清除；
 * - 隐私模式等 localStorage 不可用时静默降级为无草稿。
 */

export interface DraftDish {
  /** 用户最终确认的菜名（AI 建议名另存） */
  name: string
  nameSource: 'ai' | 'user'
  aiSuggestedName?: string
  confidence?: number
  candidates?: string[]
  rating: number | null
  manualAvoid: boolean
  comment?: string
  price?: number | null
  scene?: string
}

export interface CaptureDraft {
  savedAt: number
  /** 店铺联想选中的店名（未建档店铺也保留，进入确认页后再决定新建/匹配） */
  restaurantName: string
  dishes: DraftDish[]
  /** AI 识别是否已降级（恢复后直接进手动录入态） */
  degraded: boolean
}

const KEY = 'fooddex:capture-draft:v1'
const TTL_MS = 24 * 60 * 60 * 1000

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage
    const probe = '__fooddex_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function saveCaptureDraft(draft: Omit<CaptureDraft, 'savedAt'>): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() }))
  } catch {
    // 配额满等异常不阻塞打卡主流程
  }
}

export function clearCaptureDraft(): void {
  storage()?.removeItem(KEY)
}

export interface DraftLoadResult {
  draft: CaptureDraft
  /** 距保存已过时长（ms），供「恢复于 x 分钟前」提示 */
  ageMs: number
}

/** 读取未过期草稿；过期/损坏/为空返回 null（并顺手清掉脏数据） */
export function loadCaptureDraft(now = Date.now()): DraftLoadResult | null {
  const s = storage()
  if (!s) return null
  const raw = s.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CaptureDraft
    const ageMs = now - parsed.savedAt
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > TTL_MS) {
      s.removeItem(KEY)
      return null
    }
    if (!Array.isArray(parsed.dishes)) {
      s.removeItem(KEY)
      return null
    }
    return { draft: parsed, ageMs }
  } catch {
    s.removeItem(KEY)
    return null
  }
}

/** 草稿是否值得恢复（至少有店名或一道菜） */
export function isDraftRestorable(draft: CaptureDraft): boolean {
  return draft.restaurantName.trim().length > 0 || draft.dishes.length > 0
}
