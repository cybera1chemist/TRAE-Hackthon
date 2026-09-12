/**
 * 菜品匹配引擎（TDD §3.4 / §11 matcher 签名）—— Agent-1 T1-05 / T3-04
 *
 *   exact: 归一化后同名                                    → score = 1.00
 *   else:
 *     lev  = levenshteinRatio(normA, normB)
 *     jac  = bigramJaccard(normA, normB)
 *     contain = 包含关系且长度差 ≤ 2 字 → 0.85
 *     score = max(0.6*lev + 0.4*jac, contain)
 *
 *   score ≥ 0.95        → exact   自动合并（可撤销）
 *   0.80 ≤ score < 0.95 → fuzzy   必须用户确认 merged / keptSeparate
 *   否则                → new
 *
 * 匹配范围仅同 restaurantId：由调用方过滤 existing 后传入（TDD §3.4）。
 */
import type { Dish, ID } from '@/domain/entities'
import { normalizeDishName } from './normalize'

export type MatchType = 'exact' | 'fuzzy' | 'new'

export interface OcrCandidate {
  name: string
  aliases?: string[]
}

export interface MatchResult {
  type: MatchType
  dishId?: ID
  score: number
  userDecisionRequired: boolean
}

export const MATCH_AUTO = 0.95
export const MATCH_FUZZY = 0.8

/** 编辑距离（Levenshtein），滚动数组实现 */
export function levenshteinDistance(a: string, b: string): number {
  const la = a.length
  const lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la

  let prev = Array.from({ length: lb + 1 }, (_, j) => j)
  let curr = new Array<number>(lb + 1)

  for (let i = 1; i <= la; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[lb]
}

/** 编辑距离相似度 = 1 - distance / max(lenA, lenB) */
export function levenshteinRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshteinDistance(a, b) / max
}

/** 字符二元组集合（长度 1 退化为单元组，避免空集） */
export function bigrams(s: string): string[] {
  if (s.length === 0) return []
  if (s.length === 1) return [s]
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
  return [...set]
}

/** 二元组 Jaccard = |A∩B| / |A∪B| */
export function bigramJaccard(a: string, b: string): number {
  const ga = new Set(bigrams(a))
  const gb = new Set(bigrams(b))
  if (ga.size === 0 && gb.size === 0) return 1
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  const union = ga.size + gb.size - inter
  return union === 0 ? 0 : inter / union
}

/** 包含关系得分：一方包含另一方且长度差 ≤ 2 → 0.85，否则 0 */
export function containmentScore(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0
  if (Math.abs(a.length - b.length) > 2) return 0
  return a.includes(b) || b.includes(a) ? 0.85 : 0
}

/** 两个名字的综合相似度（0–1） */
export function similarity(a: string, b: string): number {
  const na = a.toLowerCase()
  const nb = b.toLowerCase()
  if (na === nb) return 1
  const lev = levenshteinRatio(na, nb)
  const jac = bigramJaccard(na, nb)
  const contain = containmentScore(na, nb)
  return Math.max(0.6 * lev + 0.4 * jac, contain)
}

/** OCR 候选与某道菜之间的最佳分数（主名 + 别名两两比较） */
function bestCandidateScore(candidate: OcrCandidate, dish: Dish): number {
  const ocrNorm = normalizeDishName(candidate.name)
  const ocrNames = [ocrNorm.name, ...ocrNorm.aliases, ...(candidate.aliases ?? [])]

  const dishNorm = normalizeDishName(dish.name)
  const dishNames = [dishNorm.name, ...dishNorm.aliases, ...dish.aliases]

  let best = 0
  for (const on of ocrNames) {
    if (!on) continue
    for (const dn of dishNames) {
      if (!dn) continue
      if (on.toLowerCase() === dn.toLowerCase()) return 1
      const s = similarity(on, dn)
      if (s > best) best = s
    }
  }
  return best
}

/**
 * 匹配一个 OCR 候选项到现有菜品。
 * @param existing 必须已按 restaurantId 过滤（匹配范围仅同店）
 */
export function matchDish(raw: OcrCandidate, existing: Dish[]): MatchResult {
  if (existing.length === 0) return { type: 'new', score: 0, userDecisionRequired: false }

  let bestDish: Dish | null = null
  let bestScore = 0
  for (const dish of existing) {
    const s = bestCandidateScore(raw, dish)
    if (s > bestScore) {
      bestScore = s
      bestDish = dish
      if (s === 1) break
    }
  }

  if (!bestDish) return { type: 'new', score: 0, userDecisionRequired: false }

  if (bestScore >= MATCH_AUTO) {
    return { type: 'exact', dishId: bestDish.id, score: bestScore, userDecisionRequired: false }
  }
  if (bestScore >= MATCH_FUZZY) {
    return { type: 'fuzzy', dishId: bestDish.id, score: bestScore, userDecisionRequired: true }
  }
  return { type: 'new', score: bestScore, userDecisionRequired: false }
}
