/**
 * FoodDex · 菜品识别 prompt v1（Agent-2 准备区草稿）
 *
 * 对应任务：T2-02 recognize prompt v1
 * 对应接口：AIProvider.recognizeDish (src/infra/ai/types.ts，Agent-0 已冻结)
 * 对应 schema：recognizeRespSchema (src/infra/ai/schemas.ts)
 *
 * 供应商兼容性：vendor-agnostic 系统提示，配合各 adapter 的
 * function-calling / response_format=json 即可。Qwen-VL-Max、Doubao-1.5-vision-pro、
 * GLM-4V-Plus 均支持 OpenAI 兼容结构化输出。
 *
 * 关键约束（PRD §6.2 + Agent-0 冻结契约）：
 *   - 仅输出 JSON，禁止 markdown / 解释
 *   - confidence ∈ [0,1] 必须诚实校准
 *   - 菜名用中文全称，不写方言/俚语/拼音
 *   - bbox 必须返回（契约要求 BBoxTuple 非可选），覆盖菜品大致区域
 *   - candidates 必须返回数组（可为 [name]）
 *   - 一张图可含多道菜，每道独立置信度与候选 Top3
 *   - menuHints 用于消歧
 */

import type { RecognizeReq } from '@/infra/ai/types'

export const PROMPT_ID = 'recognize.v1'
export const PROMPT_VERSION = '2026.09.v1'

/**
 * 输出 JSON 形态（与 src/infra/ai/schemas.ts recognizeRespSchema 对齐）：
 * {
 *   "requestId": "...",  // 由 adapter 注入，模型不产出
 *   "results": [
 *     {
 *       "imageIndex": 0,
 *       "imageQuality": { "blur": false, "hasFood": true },
 *       "dishes": [
 *         { "name": "水煮牛肉", "confidence": 0.91,
 *           "candidates": ["水煮牛肉", "水煮鱼", "毛血旺"],
 *           "bbox": [120, 80, 900, 760] }
 *       ]
 *     }
 *   ],
 *   "model": { "vendor": "...", "version": "..." }  // 由 adapter 注入
 * }
 * 模型只需产出 results 数组；requestId/model 由 adapter 填充。
 */
export const system = `你是一名中餐视觉识别专家，专门识别中国菜（含港台、东南亚华人菜）。

严格规则：
1. 仅输出一个 JSON 对象 { "results": [...] }，长度必须等于输入图片数量，按 imageIndex 升序。禁止任何 markdown、代码块标记、解释、前后缀文字。
2. 每张图输出 imageQuality.blur（模糊 true/清晰 false）与 imageQuality.hasFood（图内是否含可识别食物）。
3. dishes 数组：每道独立菜品一项。无任何食物时返回空数组 []。
4. name：中文全称（如"水煮牛肉"），不要方言/俚语/拼音/英译。若多道同名菜在同一图，每道一项。
5. confidence：0–1 浮点，必须诚实反映你对该菜名的把握。模型侧目标：≥0.8 高置信采纳率 ≥60%。不得所有菜都给 0.99。
6. candidates：Top3 候选菜名（含 name 本身，按置信度降序），不可超过 3 项；无候选时返回 [name]。
7. bbox：菜品在图中的边界框 [x1, y1, x2, y2]（左上、右下，像素，原点为图片左上）。必须返回，覆盖菜品大致区域；多道菜时各自给 bbox。
8. 不得编造价格、规格、菜系、店铺等本接口未要求的信息。
9. 若用户在 user 消息中给出 menuHints，且图内菜名与之存在同名/近义（如"水煮牛肉"≈"水煮肉片"），优先返回 menuHints 中出现的那个标准名，并在 candidates 中保留视觉原始判断。
10. 拒绝非食物图：imageQuality.hasFood=false 且 dishes=[]。
11. 拒绝整个请求（如全部为非食物图）也返回合法 JSON，不要报错文本。`

/** 构造 user 消息：图片由 adapter 以 multimodal message 形式注入，文本部分由本函数产出 */
export function buildUser(req: RecognizeReq): string {
  const lines: string[] = []
  lines.push(`共 ${req.images.length} 张图片，请逐张识别。`)
  if (req.context?.menuHints?.length) {
    lines.push(`本店已有菜品（用于消歧，优先返回其中标准名）：${req.context.menuHints.join('、')}`)
  }
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
