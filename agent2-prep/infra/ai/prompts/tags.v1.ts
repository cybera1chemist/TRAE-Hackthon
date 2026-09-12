/**
 * FoodDex · 标签提取 prompt v1（Agent-2 准备区草稿）
 *
 * 对应任务：T2-05 标签提取 prompt
 * 对应接口：AIProvider.extractTags (src/infra/ai/types.ts)
 * 对应 schema：tagRespSchema (src/infra/ai/schemas.ts)
 *
 * 供应商兼容性：vendor-agnostic。建议生产用 qwen-vl-plus 或 GLM-4V-Plus。
 *
 * 关键约束（PRD §6.4 / TDD §5.3 + Agent-0 冻结契约）：
 *   - 输出形状 ExtractedTags：各维度可选（无即省略字段，前端补默认）
 *   - cuisine.primary 全局单选（用于占比图）
 *   - confidence < 0.6 不返回
 *   - 表外标签强制放 custom
 *   - 受控词表摘要随请求下发（约 2–4KB）
 *   - 失败不阻断主流程
 */

import type { TagReq } from '@/infra/ai/types'
import type { TagDim } from '@/domain/entities/tag'

export const PROMPT_ID = 'tags.v1'
export const PROMPT_VERSION = '2026.09.v1'

/** 受控词表注入接口；由调用方从 domain/vocab 读取并传入 */
export interface VocabPayload {
  version: string
  taste: string[]
  cuisine: string[]
  ingredient: string[]
  cooking: string[]
  scene: string[]
}

/**
 * 输出 JSON 形态（与 src/infra/ai/schemas.ts tagRespSchema 对齐）：
 * {
 *   "tags": {
 *     "taste":   [{ "value": "麻辣", "confidence": 0.93 }],
 *     "cuisine": { "primary": { "value": "川菜", "confidence": 0.97 },
 *                  "secondary": [{ "value": "火锅", "confidence": 0.55 }] },
 *     "ingredient": [{ "value": "牛肉", "confidence": 0.9 }],
 *     "cooking":    [{ "value": "水煮", "confidence": 0.8 }],
 *     "scene":      [{ "value": "聚餐", "confidence": 0.7 }],
 *     "custom":     [{ "value": "下饭", "confidence": 0.62 }]
 *   }
 * }
 * 说明：各维度可选；无内容时省略字段（不要返回空数组）。cuisine 必须为对象。
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
8. 近义归一：辣/很辣/重辣 → 麻辣 或 香辣（按图片实际判断）；甜口/偏甜 → 甜；如词表已指定标准词，强制用标准词。
9. 不得返回与菜名重复的标签（菜名"水煮牛肉"不要再输出 ingredient=牛肉 之外的冗余信息；但可输出 cooking=水煮）。
10. 评论为空时，仅基于图片与菜名抽取，confidence 整体下调 0.1。
11. 若图片或菜名信息严重不足，所有维度全部省略（输出 {}），不要硬猜。`

export function buildUser(req: TagReq, vocab: VocabPayload): string {
  const lines: string[] = []
  lines.push(`菜名：${req.dishName}`)
  if (req.comment) lines.push(`用户短评：${req.comment}`)
  if (req.sceneHint) lines.push(`场景提示：${req.sceneHint}`)
  if (req.vocabVersion) lines.push(`词表版本：${req.vocabVersion}`)
  else lines.push(`词表版本：${vocab.version}`)
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

/** 维度枚举导出，供 adapter 在做 tool/function schema 时复用 */
export const TAG_DIMS: TagDim[] = [
  'taste',
  'cuisine',
  'ingredient',
  'cooking',
  'scene',
  'custom',
]
