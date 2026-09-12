/**
 * FoodDex · 菜单 OCR prompt v1（Agent-2 准备区草稿）
 *
 * 对应任务：T3-02 menu-scan prompt v1
 * 对应接口：AIProvider.scanMenu (src/infra/ai/types.ts)
 * 对应 schema：menuScanRespSchema (src/infra/ai/schemas.ts)
 *
 * 供应商兼容性：vendor-agnostic。建议生产首选 qwen-vl-ocr（专用 OCR），
 * 反光/塑封菜单可回退 doubao-1.5-vision-pro。
 *
 * 关键约束（PRD §6.3 / TDD §5.3 + Agent-0 冻结契约）：
 *   - price: number | null（无价格时输出 null，不要省略字段）
 *   - bbox 必须返回（契约非可选）
 *   - 酒水、茶位费、纸巾费归入"其他"分区
 *   - 不可读区域输出 unreadableRegions bbox 列表
 *   - 不编造：读不清的菜名宁可不返回，放入 unreadableRegions
 *   - few-shot 分区示例
 */

import type { MenuScanReq } from '@/infra/ai/types'

export const PROMPT_ID = 'menu-scan.v1'
export const PROMPT_VERSION = '2026.09.v1'

/**
 * 输出 JSON 形态（与 src/infra/ai/schemas.ts menuScanRespSchema 对齐）：
 * {
 *   "results": [
 *     {
 *       "imageIndex": 0,
 *       "sections": [
 *         { "name": "招牌菜",
 *           "items": [
 *             { "name": "水煮牛肉", "price": 58, "spec": "例",
 *               "confidence": 0.88, "bbox": [120,340,720,404] }
 *           ] }
 *       ],
 *       "unreadableRegions": [[40,900,1040,1180]]
 *     }
 *   ]
 * }
 */
export const system = `你是中餐菜单 OCR 专家，擅长识别塑封、反光、多栏、中英混排的纸质菜单。

严格规则：
1. 仅输出一个 JSON 对象 { "results": [...] }，长度等于输入图片数，按 imageIndex 升序。禁止 markdown、解释、前后缀。
2. 每张图输出 sections 数组与 unreadableRegions 数组。
3. sections：按菜单上的分区组织。常见分区名：招牌菜、热菜、凉菜、汤类、主食、套餐、酒水、其他。
   - 酒水、茶位费、餐位费、纸巾费、服务费等非菜品条目一律归入名为"其他"的 section。
   - 若菜单本身无分区标题，全部归入"招牌菜"section（不要凭空造分区名）。
4. items：每个菜品一行。name（中文全称，去规格后缀如"/例"、"(大份)"）、price（数值元；无价格时输出 null，不要省略字段）、spec（例/大份/小份/位，无则省略）、confidence（0–1）、bbox（[x1,y1,x2,y2] 像素，必须返回）。
5. name 规范化：去除尾部 /例、/份、/位、（大）、（小）等规格后缀，规格进 spec 字段。去除装饰符号（★※◆）。
6. 价格残留：若"name"行混入价格（如"水煮牛肉 58"），必须拆分：name="水煮牛肉"，price=58。
7. 不可读处理：模糊、反光、被遮挡、无法确认的菜品不要猜，将该区域 bbox 放入 unreadableRegions。
8. confidence 校准：清晰印刷 ≥0.9，一般 0.7–0.9，模糊或推断 <0.7。不得无差别给 0.95。
9. 中英混排：中文名进 name，英文（如 Kung Pao Chicken）不进 candidates（本接口无 candidates 字段）。
10. 不编造：菜单未出现的菜不得返回。
11. 若用户在 user 消息中给出 existingDishNames，本店已有菜品在 OCR 后可直接返回，无需特殊标记（匹配由前端 matchDish 完成）。

few-shot 分区示例（塑封菜单）：
输入图片含一段：
  招牌菜
  水煮牛肉 / 例 ￥58
  夫妻肺片 ￥38
  酒水
  雪花啤酒 ￥10
输出对应：
  "sections": [
    { "name": "招牌菜", "items": [
      { "name": "水煮牛肉", "price": 58, "spec": "例", "confidence": 0.92, "bbox": [...] },
      { "name": "夫妻肺片", "price": 38, "confidence": 0.9, "bbox": [...] }
    ]},
    { "name": "其他", "items": [
      { "name": "雪花啤酒", "price": 10, "confidence": 0.85, "bbox": [...] }
    ]}
  ]`

export function buildUser(req: MenuScanReq): string {
  const lines: string[] = []
  lines.push(`共 ${req.images.length} 张菜单图片，请逐张 OCR 并分区。`)
  // 注：Agent-0 的 MenuScanReq 没有 existingDishNames 字段，匹配由前端调用前自行拉取
  if (req.restaurantId) lines.push(`店铺 ID：${req.restaurantId}（仅供参考）`)
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
