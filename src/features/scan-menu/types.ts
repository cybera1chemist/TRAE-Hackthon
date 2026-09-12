/**
 * 菜单扫描 feature 内部类型（Agent-4 专有，非冻结契约）。
 * 冻结类型一律从 @/domain/entities 引用；AI DTO 从 @/infra/ai 引用。
 * 依据：TDD §3.4、PRD §5.3.1、EC-MENU-01~07。
 */
import type {
  BBox,
  ID,
  ISODate,
  OcrMatchType,
  OcrUserDecision,
  ScanDiffSummary,
} from '@/domain/entities'
import type { AIErrorCode } from '@/infra/ai'

/** 扫描页状态机（TDD §3.4：upload→preview→ocr→confirm→saving→done，任意态可回退） */
export type ScanPhase = 'upload' | 'preview' | 'ocr' | 'confirm' | 'saving' | 'done'

/** OCR 失败的归一化形态（错误码来自 AIError，TDD §5.1；超时 20s/张降级手录） */
export interface ScanOcrError {
  code: AIErrorCode
  retriable: boolean
  message?: string
}

/** 上传图像预检结果（TDD §3.6：blur 用 Laplacian；EC-MENU-02 反光/过暗提示） */
export interface ImagePrecheck {
  blur: boolean
  glare: boolean
  tooDark: boolean
}

/** 单张菜单图槽位（EC-MENU-01：≤10 张，按上传顺序分图展示，允许整图删除重传） */
export interface ScanImageSlot {
  id: ID
  /** 本地预览 objectURL（BlobStore 上报由 workflow 完成，Agent-1 BlobStore 就绪后接线） */
  previewUrl: string
  sizeBytes: number
  fileName: string
  precheck: ImagePrecheck
  /** P1：手动旋转 90°（EC-MENU-02） */
  rotation: 0 | 90 | 180 | 270
  /** 预检时读出的像素尺寸（Photo 登记用；解码失败时缺省） */
  width?: number
  height?: number
}

/** 确认页行分类（EC-MENU-04：酒水/茶位/餐具费归「其他」折叠区，不计入解锁统计） */
export type MenuLineKind = 'dish' | 'drink' | 'fee'

/** 确认页行草稿：OcrItem 的 UI 编辑态，保存时经 userDecision 转为 ResolvedOcrItem */
export interface MenuLineDraft {
  /** 本地行 id（未入库 = temp-xxx；已入库 = OcrItem.id） */
  lineKey: string
  ocrItemId?: ID
  /** 来源图下标（与 draft.images 顺序一致；框选重扫按同图替换行，EC-MENU-04） */
  imageIndex?: number
  section: string
  rawText: string
  name: string
  price: number | null
  spec?: string
  confidence: number
  bbox?: BBox
  kind: MenuLineKind
  match: {
    type: OcrMatchType
    dishId?: ID
    score?: number
    candidates?: string[]
  }
  /** 无 userDecision 不允许转 Dish（PRD §7.7；exact/≥0.95 由系统自动置位可撤销） */
  decision?: OcrUserDecision
  /** 框选重扫产生的行：记录重扫区域（EC-MENU-04 不可读区块） */
  rescanOf?: BBox
}

/** 不可读区块（MenuScanResp.unreadableRegions 的转换态，框选重扫入口） */
export interface UnreadableRegion {
  imageIndex: number
  bbox: BBox
}

/** 扫描全程草稿（T3-08：退出恢复；任意态可回退，结果入 draft） */
export interface ScanDraft {
  restaurantId?: ID
  phase: ScanPhase
  images: ScanImageSlot[]
  lines: MenuLineDraft[]
  unreadable: UnreadableRegion[]
  isIncremental: boolean
  diffSummary?: ScanDiffSummary
  ocrError?: ScanOcrError
  saveError?: string
  /** 草稿新鲜度判据（isDraftFresh：默认 24h 过期） */
  updatedAt: ISODate
}
