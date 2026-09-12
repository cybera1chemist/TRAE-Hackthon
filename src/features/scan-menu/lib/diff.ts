/**
 * 增量扫描 diff（T3-06 / EC-MENU-05 / TDD §3.4）：以现存菜品集合为基准，
 * 对本次扫描行输出 {added, removed, renamed}，仅确认差异，旧菜默认保留（removed 仅标记不物理删除）。
 *
 * ⚠ 匹配算法本身归 Agent-1（T1-05，domain/services/matcher.ts）：本模块通过
 * DishMatcher 注入相似度函数，Agent-1 交付后一行接线，不做算法实现。
 */
import type { Dish, ID, ScanDiffSummary } from '@/domain/entities'
import type { MenuLineDraft } from '../types'

/** 注入点：lineName 与 dish 的相似度 0–1（对接 matcher.similarity / matchDish） */
export type DishMatcher = (lineName: string, dish: Dish) => number

export interface RenamedCandidate {
  dish: Dish
  suggestedName: string
  score: number
}

export interface MenuDiff {
  /** 本次新出现的菜（未被匹配、未被用户 ignored/deleted） */
  added: MenuLineDraft[]
  /** 本次扫描未出现的现存菜（仅标记，用户确认后才删） */
  removed: Dish[]
  /** 改名候选：同一菜但菜名有差异；nameSource=user 的菜仅提示不覆盖（EC-MENU-06） */
  renamed: RenamedCandidate[]
  summary: ScanDiffSummary
}

export interface ComputeDiffOptions {
  /** fuzzy 下限阈值，默认 0.8（TDD §3.4） */
  matchThreshold?: number
}

function isCountableDishLine(line: MenuLineDraft): boolean {
  if (line.kind !== 'dish') return false
  if (line.decision === 'ignored' || line.decision === 'deleted') return false
  return true
}

export function computeMenuDiff(
  lines: MenuLineDraft[],
  existingDishes: Dish[],
  match: DishMatcher,
  opts: ComputeDiffOptions = {},
): MenuDiff {
  const threshold = opts.matchThreshold ?? 0.8
  const countable = lines.filter(isCountableDishLine)

  const matchedDishIds = new Set<ID>()
  const renamed: RenamedCandidate[] = []

  /** 记录配对；菜名有差异时产出改名候选 */
  function pairWith(line: MenuLineDraft, dish: Dish, score: number): void {
    matchedDishIds.add(dish.id)
    if (line.name.trim() !== dish.name) {
      renamed.push({ dish, suggestedName: line.name, score })
    }
  }

  // 1) 显式关联行（确认页决议 / matcher 预填的 exact/fuzzy 关联）
  const dishById = new Map(existingDishes.map((d) => [d.id, d]))
  const unmatched: MenuLineDraft[] = []
  for (const line of countable) {
    const dish = line.match.dishId != null ? dishById.get(line.match.dishId) : undefined
    if (dish) pairWith(line, dish, line.match.score ?? 1)
    else unmatched.push(line)
  }

  // 2) 未关联行 × 现存菜：注入 matcher 找最优配对（score ≥ threshold）
  const added: MenuLineDraft[] = []
  for (const line of unmatched) {
    let best: { dish: Dish; score: number } | undefined
    for (const dish of existingDishes) {
      if (matchedDishIds.has(dish.id)) continue
      const score = match(line.name, dish)
      if (score >= threshold && score > (best?.score ?? 0)) best = { dish, score }
    }
    if (best) pairWith(line, best.dish, best.score)
    else added.push(line)
  }

  // 3) removed：未被任何行命中的现存菜
  const removed = existingDishes.filter((d) => !matchedDishIds.has(d.id))

  return {
    added,
    removed,
    renamed,
    summary: { added: added.length, removed: removed.length, renamed: renamed.length },
  }
}
