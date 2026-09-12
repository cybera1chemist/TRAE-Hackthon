/**
 * FoodDex · 出片文案 prompt v1（Agent-2 准备区草稿）
 *
 * 对应任务：T4-05 AI 味蕾总结文案（3 段式 / 换一换）[P1]
 * 对应接口：AIProvider.generateCardCopy (src/infra/ai/types.ts)
 * 对应 schema：copyRespSchema (src/infra/ai/schemas.ts)
 *
 * 供应商兼容性：vendor-agnostic。文本生成，建议用 qwen3.8-max 或
 * GLM-5 / Doubao-pro-128k；成本敏感，无需视觉能力。
 *
 * 关键约束（PRD §8.2/§8.4 + Agent-0 冻结契约）：
 *   - 输出 CopyResp = { lines: string[] }（行数组，自由长度，建议 2–3 行）
 *   - "换一换"由前端再次调用本接口实现，单次只返回一组
 *   - 避雷态 req.avoid=true 走自嘲式幽默，禁止负面/辱骂
 *   - 模板 ID：dex_rare / dex_market / michelin_blank
 *   - 数据不足时返回空 lines（前端兜底）
 */

import type { CopyReq } from '@/infra/ai/types'
import type { CardTemplateId } from '@/domain/entities/profile'

export const PROMPT_ID = 'card-copy.v1'
export const PROMPT_VERSION = '2026.09.v1'

/**
 * 输出 JSON 形态（与 src/infra/ai/schemas.ts copyRespSchema 对齐）：
 * { "lines": ["「麻辣 +1，辣味图鉴 45%」", "牛肉滑嫩，麻味够正。"] }
 * 行数建议 2–3 行，每行 ≤30 字。
 */
export const system = `你是游戏化美食图鉴的文案生成器，产出可堆叠显示的成就短句行数组。

严格规则：
1. 仅输出一个 JSON 对象 { "lines": ["...", "...", "..."] }，禁止 markdown 与解释。
2. lines 为字符串数组，建议 2–3 行，每行 ≤30 字。第一行偏游戏感标题（如"新图鉴解锁！"），后续行可带数据成就（如"你的麻辣图鉴 +1，辣味收集度 45%"）。
3. 文案必须基于用户实际数据（tags/rating/avoid），不得编造未给定的统计数字。
4. 语气：游戏图鉴风格（宝可梦图鉴感），不要油腻美食博主腔。可以活泼、自嘲、史诗化，但避免夸张失真。
5. 评分映射：5 星 → 传说感；4 星 → 稀有感；3 星 → 普通收集；1–2 星 → 自嘲。
6. 当 req.avoid=true 时（避雷皮肤），文案必须自嘲幽默（如"又踩了一颗雷，你的胃比雷达还准"），禁止严肃负面。雷品皮肤是黄黑斜纹角标。
7. 严禁负面辱骂、地域攻击、涉及品牌的负面对比。避雷文案只针对菜品本身，用幽默化解。
8. 数据不足（如 tags 全空且 rating 为 null）：返回 { "lines": [] }，由前端兜底。`

const TEMPLATE_HINT: Record<CardTemplateId, string> = {
  dex_rare: '经典图鉴风格，墨绿/烫金配色，文案偏史诗收集感。',
  dex_market: '霓虹夜市风格，赛博标签，文案偏霓虹/夜宵/辣菜热血感。',
  michelin_blank: '米其林留白风格，象牙白/黑金，文案偏克制高级感，少用感叹。',
}

export function buildUser(req: CopyReq): string {
  const lines: string[] = []
  lines.push(`菜品：${req.dishName}`)
  if (req.restaurantName) lines.push(`店铺：${req.restaurantName}`)
  if (req.rating !== undefined && req.rating !== null) {
    lines.push(`评分：${req.rating} 星`)
  } else {
    lines.push('评分：未评分')
  }
  if (req.tags?.length) {
    lines.push(`标签：${req.tags.slice(0, 5).join('、')}`)
  }
  lines.push(`模板：${req.template}。${TEMPLATE_HINT[req.template]}`)
  if (req.avoid) lines.push('避雷皮肤：是。请用自嘲式幽默文案。')
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
