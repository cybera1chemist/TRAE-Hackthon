/**
 * 出片文案 prompt v1（T4-05，P1）。
 * 契约：AIProvider.generateCardCopy（src/infra/ai/types.ts 冻结），CopyResp = { lines: string[] }。
 * 依据：PRD §8.2/§8.4（游戏图鉴风、避雷皮肤自嘲幽默、数据不足不出文案）。
 * 文本模型即可（qwen-max / GLM / Doubao-pro），无需视觉能力。
 */
import type { CardTemplateId } from '@/domain/entities/profile'
import type { CopyReq } from '../types'

export const PROMPT_ID = 'card-copy.v1' as const
export const PROMPT_VERSION = '2026.09.v1' as const

/** 输出形态与 schemas.ts copyRespSchema 对齐：{ "lines": ["...", "..."] }，建议 2–3 行 */
export const system = `你是游戏化美食图鉴的文案生成器，产出可堆叠显示的成就短句行数组。

严格规则：
1. 仅输出一个 JSON 对象 { "lines": ["...", "...", "..."] }，禁止 markdown 与解释。
2. lines 为字符串数组，建议 2–3 行，每行 ≤30 字。第一行偏游戏感标题（如"新图鉴解锁！"），后续行可带数据成就（如"你的麻辣图鉴 +1，辣味收集度 45%"）。
3. 文案必须基于用户实际数据（tags/rating/avoid），不得编造未给定的统计数字。
4. 语气：游戏图鉴风格（宝可梦图鉴感），不要油腻美食博主腔。可以活泼、自嘲、史诗化，但避免夸张失真。
5. 评分映射：5 星 → 传说感；4 星 → 稀有感；3 星 → 普通收集；1–2 星 → 自嘲。
6. 当 avoid=true（避雷皮肤，黄黑斜纹角标）时，文案必须自嘲幽默（如"又踩了一颗雷，你的胃比雷达还准"），禁止严肃负面。
7. 严禁负面辱骂、地域攻击、涉及品牌的负面对比。避雷文案只针对菜品本身，用幽默化解。
8. 数据不足（tags 为空且 rating 为 null）：返回 { "lines": [] }，由前端兜底。`

const TEMPLATE_HINT: Record<CardTemplateId, string> = {
  dex_rare: '经典图鉴风格，墨绿/烫金配色，文案偏史诗收集感。',
  neon_market: '霓虹夜市风格，赛博标签，文案偏霓虹/夜宵/辣菜热血感。',
  michelin_blank: '米其林留白风格，象牙白/黑金，文案偏克制高级感，少用感叹。',
}

export function buildUser(req: CopyReq): string {
  const lines: string[] = [`菜品：${req.dishName}`]
  if (req.restaurantName) lines.push(`店铺：${req.restaurantName}`)
  lines.push(req.rating != null ? `评分：${req.rating} 星` : '评分：未评分')
  if (req.tags?.length) lines.push(`标签：${req.tags.slice(0, 5).join('、')}`)
  lines.push(`模板：${req.template}。${TEMPLATE_HINT[req.template]}`)
  if (req.avoid) lines.push('避雷皮肤：是。请用自嘲式幽默文案。')
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
