/**
 * 菜单 OCR prompt v1（T3-02）。
 * 契约：AIProvider.scanMenu（src/infra/ai/types.ts 冻结）。
 * 依据：PRD §6.3 / TDD §5.3（分区、酒水归"其他"、不可读区域、不编造、few-shot）。
 * 建议供应商：qwen-vl-ocr（专用 OCR），反光塑封菜单可回退 doubao-1.5-vision-pro。
 */
import type { MenuScanReq } from '../types'

export const PROMPT_ID = 'menu-scan.v1' as const
export const PROMPT_VERSION = '2026.09.v1' as const

/**
 * 输出形态与 schemas.ts menuScanRespSchema 对齐：
 * { "results": [{ "imageIndex", "sections": [{ "name", "items": [
 *    { "name", "price": number|null, "spec"?, "confidence", "bbox":[x1,y1,x2,y2] }] }],
 *    "unreadableRegions": [[x1,y1,x2,y2]] }] }
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
6. 价格残留：若行内混入价格（如"水煮牛肉 58"），必须拆分：name="水煮牛肉"，price=58。
7. 不可读处理：模糊、反光、被遮挡、无法确认的菜品不要猜，将该区域 bbox 放入 unreadableRegions。
8. confidence 校准：清晰印刷 ≥0.9，一般 0.7–0.9，模糊或推断 <0.7。不得无差别给 0.95。
9. 中英混排：中文名进 name；不返回英文别名（本接口无 candidates 字段）。
10. 不编造：菜单未出现的菜不得返回。

few-shot 分区示例（塑封菜单）：
输入图片含：
  招牌菜
  水煮牛肉 / 例 ￥58
  夫妻肺片 ￥38
  酒水
  雪花啤酒 ￥10
输出：
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
  const lines: string[] = [`共 ${req.images.length} 张菜单图片，请逐张 OCR 并分区。`]
  if (req.restaurantId) lines.push(`店铺 ID：${req.restaurantId}（仅供参考）`)
  lines.push('请按系统提示的 JSON 形态输出。')
  return lines.join('\n')
}
