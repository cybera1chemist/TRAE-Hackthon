/**
 * 保存前决议整理（T3-05 数据准备）：
 * - 酒水/费用行默认 ignored（EC-MENU-04 不计入解锁统计）；
 * - 决议后的 dish 行转换为 DishRepo.upsertFromOcr 的入参 ResolvedOcrItem；
 * - 无 userDecision 的行不允许出现在保存集合（PRD §7.7）。
 */
import type { ResolvedOcrItem } from '@/domain/entities'
import type { MenuLineDraft, ScanDraft } from '../types'

/** drink/fee 行未显式决议时默认 ignored */
export function applyDefaultDecisions(lines: MenuLineDraft[]): MenuLineDraft[] {
  return lines.map((l) =>
    l.kind !== 'dish' && l.decision == null ? { ...l, decision: 'ignored' as const } : l,
  )
}

/** 待保存的 dish 行：必须有 userDecision，且未被 ignored/deleted */
export function resolvableLines(draft: ScanDraft): MenuLineDraft[] {
  return applyDefaultDecisions(draft.lines).filter(
    (l) =>
      l.kind === 'dish' &&
      l.decision != null &&
      l.decision !== 'ignored' &&
      l.decision !== 'deleted',
  )
}

/** 转换为 upsertFromOcr 入参（TDD §4.2）；exact/merged 行必须带 targetDishId */
export function toResolvedItems(draft: ScanDraft): ResolvedOcrItem[] {
  return resolvableLines(draft).map((l) => ({
    ocrItemId: l.ocrItemId,
    name: l.name,
    nameSource: 'ocr',
    section: l.section === '' ? undefined : l.section,
    price: l.price,
    matchType: l.match.type,
    targetDishId: l.match.dishId,
    userDecision: l.decision as NonNullable<MenuLineDraft['decision']>,
  }))
}
