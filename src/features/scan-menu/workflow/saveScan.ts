/**
 * 扫描保存 workflow（T3-05/08 / TDD §3.4 / PRD §7.7）：
 *  1. 建 MenuScan（pending）→ 图片入 BlobStore + Photo(refType='scan') 登记回写 sourceImageIds；
 *  2. 全量行转 OcrItem 落库（含 ignored/deleted，审计完整），回写 userDecision；
 *  3. 决议行经 DishRepo.upsertFromOcr 提升为菜品（exact/fuzzy-merged 关联、new 建灰菜；
 *     nameSource=user 保护在 nameGuard/仓储内强制，无 userDecision 不入库）；
 *  4. EC-MENU-05：仅用户确认删除的 removed 菜品物理删除（旧菜默认保留）；
 *  5. MenuScan 置 confirmed + diffSummary。
 * 任一步抛错由页面捕获 → SAVE_FAILURE 回 confirm（草稿不丢，T3-08）。
 */
import type { ID } from '@/domain/entities'
import type { BlobStore, Repositories } from '@/infra/db/repositories'
import { normalizeDishName } from '@/domain/services/normalize'
import { applyDefaultDecisions, toResolvedItems } from '../lib/save'
import type { ScanDraft } from '../types'

export interface SaveScanImage {
  imageId: ID
  file: Blob
  width?: number
  height?: number
}

export interface SaveScanDeps {
  repos: Repositories
  blobStore: BlobStore
}

export interface SaveScanInput {
  draft: ScanDraft
  /** 上传图片本体（页面持有 File；手录模式可为空数组） */
  images: SaveScanImage[]
  /** 用户确认删除的「消失菜品」（EC-MENU-05；缺省全部保留） */
  confirmedRemovedDishIds?: ID[]
}

export interface SaveScanResult {
  menuScanId: ID
  createdDishIds: ID[]
  linkedDishIds: ID[]
  removedDishIds: ID[]
}

const ZERO_BBOX = { x: 0, y: 0, w: 0, h: 0 } as const

export async function saveScan(
  deps: SaveScanDeps,
  { draft, images, confirmedRemovedDishIds = [] }: SaveScanInput,
): Promise<SaveScanResult> {
  const rid = draft.restaurantId
  if (!rid) throw new Error('缺少店铺，无法保存扫描结果')

  // 1) MenuScan + 图片（Blob 本体先 put，元信息随库写入——与打卡事务同口径）
  const scan = await deps.repos.menuScans.create({
    restaurantId: rid,
    sourceImageIds: [],
    isIncremental: draft.isIncremental,
  })
  const sourceImageIds: ID[] = []
  for (const [i, img] of images.entries()) {
    const key = `scan-${scan.id}-${i}`
    const blobKey = await deps.blobStore.put(key, img.file)
    const photo = await deps.repos.photos.attach({
      refType: 'scan',
      refId: scan.id,
      blobKey,
      width: img.width ?? 0,
      height: img.height ?? 0,
      sizeBytes: img.file.size,
    })
    sourceImageIds.push(photo.id)
  }
  if (sourceImageIds.length > 0) {
    await deps.repos.menuScans.update(scan.id, {
      sourceImageIds,
      status: 'ocr_done',
    })
  }

  // 2) OcrItem 全量落库（审计）+ 决议回写；drink/fee 未决议时兜底 ignored（EC-MENU-04）
  const lines = applyDefaultDecisions(draft.lines)
  const ocrRows = await deps.repos.menuScans.addOcrItems(
    scan.id,
    lines.map((l) => ({
      section: l.section === '' ? undefined : l.section,
      rawText: l.rawText || l.name,
      normalizedName: normalizeDishName(l.name).name,
      price: l.price,
      confidence: l.confidence,
      bbox: l.bbox ?? ZERO_BBOX,
      matchResult: {
        type: l.match.type,
        dishId: l.match.dishId,
        score: l.match.score,
        candidates: l.match.candidates,
      },
    })),
  )
  for (const [i, row] of ocrRows.entries()) {
    const decision = lines[i]?.decision
    if (decision) await deps.repos.menuScans.updateOcrItem(row.id, { userDecision: decision })
  }

  // 3) 决议行提升为菜品（仓储内强制人工保护）
  const { created, linked } = await deps.repos.dishes.upsertFromOcr(rid, toResolvedItems(draft))

  // 4) 用户确认删除的消失菜品（默认保留，见 EC-MENU-05）
  for (const dishId of confirmedRemovedDishIds) {
    await deps.repos.dishes.remove(dishId, { keepLogs: false })
  }

  // 5) 收尾
  await deps.repos.menuScans.update(scan.id, {
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    diffSummary: draft.diffSummary,
  })

  return {
    menuScanId: scan.id,
    createdDishIds: created,
    linkedDishIds: linked,
    removedDishIds: [...confirmedRemovedDishIds],
  }
}
