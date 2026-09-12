/**
 * 本地埋点与耗时日志（T2-09 / PRD §7.2 v1 数据仅存本地）。
 *
 * - 事件写入 localStorage 环形缓冲（默认保留 200 条），不发起任何网络请求；
 * - 关键耗时：recognize（识别）、compress（压缩）、save（保存事务）以 dur 字段记录；
 * - 失败埋点带 err（AIErrorCode 或异常消息），用于真机抽验降级路径覆盖率；
 * - 读取接口供 Settings 调试页 / Agent-6 E2E 断言使用。
 */

const KEY = 'fooddex:analytics:v1'
const MAX_EVENTS = 200

export type CaptureEvent =
  | 'capture_start'
  | 'photo_add'
  | 'photo_compress'
  | 'camera_fallback'
  | 'recognize_start'
  | 'recognize_success'
  | 'recognize_degraded'
  | 'recognize_cancel'
  | 'save_start'
  | 'save_success'
  | 'save_fail'
  | 'dish_unlock'
  | 'dish_append'
  | 'tag_backfill_done'
  | 'tag_confirm'

export interface AnalyticsRecord {
  /** 事件时间（ms epoch） */
  t: number
  event: CaptureEvent
  dur?: number
  props?: Record<string, unknown>
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function trackCapture(event: CaptureEvent, props?: Record<string, unknown>): void
export function trackCapture(
  event: CaptureEvent,
  durMs: number,
  props?: Record<string, unknown>,
): void
export function trackCapture(
  event: CaptureEvent,
  durOrProps?: number | Record<string, unknown>,
  maybeProps?: Record<string, unknown>,
): void {
  const s = storage()
  if (!s) return
  const record: AnalyticsRecord =
    typeof durOrProps === 'number'
      ? { t: Date.now(), event, dur: Math.round(durOrProps), props: maybeProps }
      : { t: Date.now(), event, props: durOrProps }
  try {
    const list = readCaptureEvents()
    list.push(record)
    const trimmed = list.slice(-MAX_EVENTS)
    s.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // 埋点失败绝不影响业务流程
  }
}

/** 读取全部埋点（时间正序）；解析失败返回空数组 */
export function readCaptureEvents(): AnalyticsRecord[] {
  try {
    const raw = storage()?.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AnalyticsRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 清空埋点（设置页"清空数据"联动） */
export function clearCaptureEvents(): void {
  storage()?.removeItem(KEY)
}

/** 计时器：withDuration 包裹异步段，自动记录 dur（ms） */
export async function withDuration<T>(
  event: CaptureEvent,
  fn: () => Promise<T>,
  propsOnDone?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    trackCapture(event, performance.now() - start, propsOnDone?.(result))
    return result
  } catch (e) {
    trackCapture(event, performance.now() - start, { err: (e as Error)?.message ?? String(e) })
    throw e
  }
}
