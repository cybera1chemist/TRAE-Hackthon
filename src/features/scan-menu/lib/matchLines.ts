/**
 * matcher 接线（T3-04）：Agent-1 的 matchDish（T1-05）接入确认页行草稿。
 * - exact（≥0.95）：系统自动置位 decision='linked'（可撤销，PRD §7.7）；
 * - fuzzy（0.8–0.95）：仅回填 match，decision 留空 → 阻塞保存，必须用户确认 merged/keptSeparate；
 * - new / <0.8：回填 match.type='new'，由用户决议。
 * 算法本身不改（分工 §3：匹配算法归 Agent-1，只调用）。
 */
import type { Dish } from '@/domain/entities'
import { matchDish, similarity } from '@/domain/services/matcher'
import { normalizeDishName } from '@/domain/services/normalize'
import type { MenuLineDraft } from '../types'
import type { DishMatcher } from './diff'

/** 为 dish 行回填 matchResult；已有决议的行（手添/恢复草稿）不覆盖 */
export function applyMatchResults(lines: MenuLineDraft[], existingDishes: Dish[]): MenuLineDraft[] {
  return lines.map((line) => {
    if (line.kind !== 'dish') return line
    if (line.decision != null) return line
    const result = matchDish({ name: line.name }, existingDishes)
    return {
      ...line,
      match: {
        type: result.type,
        dishId: result.dishId,
        score: result.score,
        candidates:
          result.dishId != null
            ? existingDishes.filter((d) => d.id === result.dishId).map((d) => d.name)
            : undefined,
      },
      // exact 由系统自动置位，可撤销（PRD §7.7）；fuzzy/new 必须用户决议
      decision: result.type === 'exact' ? ('linked' as const) : line.decision,
    }
  })
}

/** diff 注入点：归一化主名+别名两两取最优相似度（与 matcher 同一口径） */
export function makeDishMatcher(): DishMatcher {
  return (lineName: string, dish: Dish): number => {
    const lineNorm = normalizeDishName(lineName)
    const dishNorm = normalizeDishName(dish.name)
    const lineNames = [lineNorm.name, ...lineNorm.aliases]
    const dishNames = [dishNorm.name, ...dishNorm.aliases, ...dish.aliases]
    let best = 0
    for (const a of lineNames) {
      if (!a) continue
      for (const b of dishNames) {
        if (!b) continue
        const s = similarity(a, b)
        if (s > best) best = s
      }
    }
    return best
  }
}
