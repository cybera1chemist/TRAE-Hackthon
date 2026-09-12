/**
 * 评分与避雷联动规则（T1-07 / PRD §5.1）：
 * - 评分降到 ≤2 星：避雷开关自动滑开 + 轻震动（移动端 navigator.vibrate，P1）；
 * - 评分回升 >2 星：不自动关闭避雷（撤销须用户显式操作，避免误触掩盖踩雷事实）；
 * - 手动开避雷：不改评分（两者是独立信号，聚合口径见 domain/services/avoid.ts）。
 */
import { isAvoidLog } from '@/domain/entities/common'

export interface RatingAvoidState {
  rating: number | null
  manualAvoid: boolean
}

export interface RatingAvoidLinkage {
  rating: number | null
  manualAvoid: boolean
  /** 本次变更是否触发了「自动开避雷」（UI 据此震动/高亮提示） */
  autoAvoidTriggered: boolean
}

/** 评分变更后的联动状态（纯函数，UI 直接以返回值 setState） */
export function applyRatingChange(
  state: RatingAvoidState,
  next: number | null,
): RatingAvoidLinkage {
  const wasAvoid = isAvoidLog(state.rating, state.manualAvoid)
  const willAvoid = isAvoidLog(next, state.manualAvoid)
  const autoAvoidTriggered = !wasAvoid && willAvoid && !state.manualAvoid && next !== null
  return {
    rating: next,
    manualAvoid: autoAvoidTriggered ? true : state.manualAvoid,
    autoAvoidTriggered,
  }
}

/** 避雷开关变更（无联动，仅透传；独立函数便于 UI 统一走一个入口） */
export function applyAvoidChange(state: RatingAvoidState, next: boolean): RatingAvoidLinkage {
  return { rating: state.rating, manualAvoid: next, autoAvoidTriggered: false }
}

/** 自动开避雷时的轻震动（P1：仅移动端且支持时生效；任何异常静默吞掉） */
export function pulseAvoidHint(): void {
  try {
    navigator.vibrate?.(30)
  } catch {
    // 不支持 vibrate 的环境静默忽略
  }
}
