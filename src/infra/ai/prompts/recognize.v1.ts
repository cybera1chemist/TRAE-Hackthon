/**
 * 菜品识别 prompt v1（T2-02）。
 * 契约：AIProvider.recognizeDish（src/infra/ai/types.ts 冻结）。
 * vendor-agnostic：配合各 adapter 的 response_format=json / function-calling 使用。
 * 依据：PRD §6.2（强 JSON、置信度诚实、中文全称、不编造价格、menuHints 消歧）。
 */
import type { RecognizeReq } from '../types'

export const PROMPT_ID = 'recognize.v1' as const
export const PROMPT_VERSION = '2026.09.v1' as const

/**
 * 模型只需产出 results 数组；requestId/model 由 adapter 注入。
 * 输出形态与 schemas.ts recognizeRespSchema 对齐：
 * { "results": [{ "imageIndex", "imageQuality": {"blur","hasFood"},
 *    "dishes": [{ "name", "confidence", "candidates": [...≤3], "bbox":[x1,y1,x2,y2] }] }] }
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
11. 即使整批均为非食物图也返回合法 JSON，不要报错文本。`

/** user 文本部分；图片由 adapter 以 multimodal message 注入 */
export function buildUser(req: RecognizeReq): string {
  const lines: string[] = [`共 ${req.images.length} 张图片，请逐张识别。`]
  if (req.context?.menuHints?.length) {
    lines.push(`本店已有菜品（用于消歧，优先返回其中标准名）：${req.context.menuHints.join('、')}`)
  }
  if (req.context?.restaurantId) {
    lines.push(`店铺 ID：${req.context.restaurantId}（仅供参考）`)
  }
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
