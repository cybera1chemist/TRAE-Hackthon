/**
 * bbox 工具：AI 响应 [x1,y1,x2,y2]（BBoxTuple）↔ 存储口径 {x,y,w,h}（BBox）。
 * 依据：domain/entities/scan.ts 冻结注释「由 workflow 转换」+ PRD §7.7。
 * 服务于：OCR 候选落库（MenuScanRepo.addOcrItems）与不可读区块框选重扫（EC-MENU-04）。
 */
import type { BBox } from '@/domain/entities'
import type { BBoxTuple } from '@/infra/ai'

/** 转换为存储口径；容忍 x1>x2 的倒序输入 */
export function toBBox(t: BBoxTuple): BBox {
  const [x1, y1, x2, y2] = t
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  }
}

/** 用户框选区域与目标行的重叠占目标 bbox 面积之比；≥0.5 视为命中（框选重扫） */
export function bboxOverlapRatio(region: BBox, target: BBox): number {
  const x1 = Math.max(region.x, target.x)
  const y1 = Math.max(region.y, target.y)
  const x2 = Math.min(region.x + region.w, target.x + target.w)
  const y2 = Math.min(region.y + region.h, target.y + target.h)
  if (x2 <= x1 || y2 <= y1) return 0
  const inter = (x2 - x1) * (y2 - y1)
  const targetArea = target.w * target.h
  if (targetArea <= 0) return 0
  return inter / targetArea
}

/** 命中用户框选区域的行下标列表（重叠 ≥ threshold，默认 0.5） */
export function linesInRegion(
  region: BBox,
  targets: Array<{ index: number; bbox: BBox }>,
  threshold = 0.5,
): number[] {
  return targets.filter((t) => bboxOverlapRatio(region, t.bbox) >= threshold).map((t) => t.index)
}
