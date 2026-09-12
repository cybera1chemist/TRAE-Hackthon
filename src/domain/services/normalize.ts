/**
 * 菜名归一化（TDD §3.4）—— Agent-1 T1-05
 *
 * 返回 { name, aliases }：
 *  - name 用于显示与存储（NFKC、全角→半角、去规格/价格/装饰、空白压缩）；
 *  - aliases 来自括号内容（如「黑椒牛柳（辣）」→ aliases=['辣']）。
 * 英文小写化仅用于比较（见 compareKeys），不改变显示名大小写。
 */

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['（', '）'],
  ['[', ']'],
  ['【', '】'],
  ['《', '》'],
  ['<', '>'],
]

// 尾部规格词（跟在 / 或 ／ 之后，或单独括号内）
const TRAILING_SLASH_SPEC = /[／/](例牌|大份|小份|例|份|位|大|小)$/
const TRAILING_PAREN_SPEC = /[（(](大|中|小|例)[)）]$/

// 价格残留（可选货币符号 + 数字 + 可选小数）
const PRICE_RE = /[¥￥$]?\d+(?:\.\d+)?/g

// 连续装饰符号（≥2 个）
const DECORATION_RE = /[★※◆◇▪▫·•\-—_]{2,}/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 全角 ASCII（U+FF01..U+FF5E）与全角空格转半角 */
function fullWidthToHalfWidth(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0)
    } else if (code === 0x3000) {
      out += ' '
    } else {
      out += ch
    }
  }
  return out
}

/** 提取所有成对括号的内容作为别名，并从主名中移除括号 */
function extractBracketAliases(input: string): { name: string; aliases: string[] } {
  const aliases: string[] = []
  let name = input

  for (const [open, close] of BRACKET_PAIRS) {
    const re = new RegExp(
      `${escapeRegExp(open)}([^${escapeRegExp(close)}]*)${escapeRegExp(close)}`,
      'g',
    )
    name = name.replace(re, (_m, inner: string) => {
      const trimmed = inner.trim()
      if (trimmed) aliases.push(trimmed)
      return ''
    })
  }
  name = name.replace(/[()（）[\]【】《》<>]/g, '')

  return { name, aliases }
}

export interface NormalizedDishName {
  name: string
  aliases: string[]
}

export function normalizeDishName(raw: string): NormalizedDishName {
  if (!raw) return { name: '', aliases: [] }

  // 1. Unicode NFKC 规范化 + 全角转半角
  const s = fullWidthToHalfWidth(raw.normalize('NFKC'))

  // 2. 括号内容拆分：主名保留，括号内容入 aliases
  let { name, aliases } = extractBracketAliases(s)

  // 3. 去除尾部规格
  name = name.replace(TRAILING_SLASH_SPEC, '').replace(TRAILING_PAREN_SPEC, '')

  // 4. 去除价格残留
  name = name.replace(PRICE_RE, '')

  // 5. 去除连续装饰符号
  name = name.replace(DECORATION_RE, '')

  // 6. 空白压缩
  name = name.replace(/\s+/g, ' ').trim()

  aliases = aliases
    .map((a) => a.replace(PRICE_RE, '').replace(DECORATION_RE, '').replace(/\s+/g, ' ').trim())
    .filter((a) => a.length > 0)

  return { name, aliases }
}

/**
 * 用于比较的归一化键集合：在 normalizeDishName 基础上英文小写化。
 * 匹配时对 name 与 aliases 都生成键，任一命中即视为同名。
 */
export function compareKeys(name: string, aliases: string[] = []): string[] {
  const base = normalizeDishName(name)
  const keys = new Set<string>()
  if (base.name) keys.add(base.name.toLowerCase())
  for (const a of base.aliases) keys.add(a.toLowerCase())
  for (const a of aliases) {
    const n = normalizeDishName(a).name
    if (n) keys.add(n.toLowerCase())
  }
  return [...keys]
}
