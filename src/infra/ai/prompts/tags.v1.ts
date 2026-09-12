/**
 * 标签提取 prompt v1（T2-05）。
 * 契约：AIProvider.extractTags（src/infra/ai/types.ts 冻结）。
 * 依据：PRD §6.4 / TDD §5.3（受控词表优先、表外入 custom、cuisine.primary 单选、
 * confidence < 0.6 不返回、失败不阻断主流程）。
 * 词表来源：Agent-1 T1-06 受控词表（domain/vocab），由调用方注入 VocabPayload。
 */
import type { TagDim } from '@/domain/entities/tag'
import type { TagReq } from '../types'

export const PROMPT_ID = 'tags.v1' as const
export const PROMPT_VERSION = '2026.09.v1' as const

/** 受控词表注入接口；由调用方从 Agent-1 的 domain/vocab 读取并传入 */
export interface VocabPayload {
  version: string
  taste: string[]
  cuisine: string[]
  ingredient: string[]
  cooking: string[]
  scene: string[]
}

export const TAG_DIMS: TagDim[] = ['taste', 'cuisine', 'ingredient', 'cooking', 'scene', 'custom']

/**
 * 输出形态与 schemas.ts tagRespSchema 对齐：
 * { "tags": { "taste"?: [{value,confidence}],
 *   "cuisine"?: { "primary"?: {value,confidence}, "secondary"?: [...] },
 *   "ingredient"?, "cooking"?, "scene"?, "custom"? } }
 * 各维度可选：无内容时省略字段（不返回空数组）。cuisine 必须为对象。
 */
export const system = `你是中餐美食标签抽取专家。给定菜品图片、菜名与用户短评，输出多维度结构化标签。

严格规则：
1. 仅输出一个 JSON 对象 { "tags": {...} }，禁止 markdown 与任何解释文字。
2. 维度：taste / cuisine / ingredient / cooking / scene / custom。各维度可选；某维度无内容时省略该字段（不要返回空数组 []）。cuisine 必须为对象 { "primary": {...}, "secondary": [...] }。
3. cuisine.primary 全局唯一（用于占比环形图，多标签会破坏百分比可比性）。secondary 最多 3 个，且 confidence 必须低于 primary。
4. 每个标签为 { "value": "标签词", "confidence": 0–1 }。
5. confidence < 0.6 的标签不要返回（前端默认不选中）。
6. 表内优先：能匹配到下方受控词表的标签，必须使用词表里的标准词形（如"麻辣"而非"很辣"）。
7. 表外标签：若图片/评论体现出词表未收录的特征（如"下饭"、"送酒"、"打卡必备"），放入 custom 维度。禁止把 custom 标签污染进 taste/cuisine 等受控维度。
8. 近义归一：辣/很辣/重辣 → 麻辣 或 香辣（按图片实际判断）；甜口/偏甜 → 甜；词表已指定标准词时强制用标准词。
9. 不得返回与菜名重复的无信息量标签；可输出烹饪方式（如菜名"水煮牛肉"→cooking=水煮）。
10. 评论为空或无图片时，仅基于可用信息抽取，confidence 整体下调 0.1。
11. 若可用信息严重不足，输出 { "tags": {} }，不要硬猜。`

export function buildUser(req: TagReq, vocab: VocabPayload): string {
  const lines: string[] = [`菜名：${req.dishName}`]
  if (req.comment) lines.push(`用户短评：${req.comment}`)
  if (req.sceneHint) lines.push(`场景提示：${req.sceneHint}`)
  lines.push(`词表版本：${req.vocabVersion ?? vocab.version}`)
  lines.push('受控词表（必须使用标准词形，表外放 custom）：')
  lines.push(`- taste: ${vocab.taste.join('、')}`)
  lines.push(`- cuisine: ${vocab.cuisine.join('、')}`)
  lines.push(`- ingredient: ${vocab.ingredient.join('、')}`)
  lines.push(`- cooking: ${vocab.cooking.join('、')}`)
  lines.push(`- scene: ${vocab.scene.join('、')}`)
  if (req.images?.length) {
    lines.push(`共 ${req.images.length} 张图片。请按系统提示的 JSON 形态输出。`)
  } else {
    lines.push('（本次无图片，仅基于菜名与短评抽取，confidence 整体下调 0.1。）')
  }
  return lines.join('\n')
}
