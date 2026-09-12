/**
 * createLogWorkflow（T2-04 / TDD §3.3 / PRD §5.1 流程 A 保存步）：
 *
 * 配额预检（EC-CAP-07）→ 店铺解析（联想精确匹配 / 新建）→ 图片入 BlobStore →
 * 每菜快照保存前状态（解锁/追加判定）→ logs.addMany 事务（照片元信息 + AI 快照 +
 * tagExtractionState=pending）→ emitDataChanged → 逐条入队 extractTags（T2-05）。
 *
 * 依赖注入：repos/blobStore/enqueueTags/emit 全部由调用方传入（页面 runtime 或测试），
 * 本文件不直接耦合组合根；AI 识别不在此发生（15s 超时降级在 recognize.ts）。
 */
import type { AddLogInput, BlobStore, Repositories } from '@/infra/db/repositories'
import type { AISnapshot, Dish, Log, Restaurant } from '@/domain/entities'
import { emitDataChanged } from '@/application/data/dataBus'
import { trackCapture } from './analytics'

export interface SavePhotoInput {
  /** 压缩后 JPEG（ArrayBuffer，来自 image.worker） */
  buffer: ArrayBuffer
  width: number
  height: number
  sizeBytes: number
}

export interface SaveDishInput {
  name: string
  nameSource: 'ai' | 'user'
  /** 用户改名时保留的 AI 原始识别名（TDD §6：人工值不被覆盖） */
  aiSuggestedName?: string
  /** exact/fuzzy 确认追加的已有菜品（缺省则新建） */
  existingDishId?: string
  confidence?: number
  candidates?: string[]
  rating: number | null
  manualAvoid: boolean
  comment?: string
  price?: number | null
  scene?: string
  /** 关联 SaveInput.photos 下标 */
  photoIndices: number[]
}

export interface SaveInput {
  restaurant: { existingId?: string; name: string }
  dishes: SaveDishInput[]
  photos: SavePhotoInput[]
  ateAt: string
  /** 识别响应模型信息（AISnapshot 追溯用；mock/手动录入时缺省） */
  model?: { vendor: string; version: string }
}

export interface SaveResult {
  restaurant: Restaurant
  logs: Log[]
  /** 本次打卡首次解锁的菜（解锁动效，T2-08） */
  unlocked: Dish[]
  /** 已解锁菜的追加打卡（第 N 次徽标，EC-CAP-13） */
  appended: Dish[]
  /** 每条 Log 的标签提取任务 ID（结果页跟踪状态） */
  tagJobIds: string[]
}

export interface CreateLogDeps {
  repos: Repositories
  blobStore: BlobStore
  /** 入队单条标签提取（runtime 里挂 AsyncQueue；测试可注入假队列） */
  enqueueTags: (logId: string) => Promise<string>
}

/** EC-CAP-07：配额不足（预估写入后占用 >90%）抛出，UI 引导清理/导出备份 */
export class StorageQuotaError extends Error {
  constructor() {
    super('STORAGE_QUOTA')
    this.name = 'StorageQuotaError'
  }
}

const QUOTA_THRESHOLD = 0.9

export async function createLogWorkflow(
  deps: CreateLogDeps,
  input: SaveInput,
): Promise<SaveResult> {
  const start = performance.now()
  trackCapture('save_start', { dishes: input.dishes.length, photos: input.photos.length })
  try {
    const result = await runSave(deps, input)
    trackCapture('save_success', performance.now() - start, {
      dishes: result.logs.length,
      unlocked: result.unlocked.length,
      appended: result.appended.length,
    })
    return result
  } catch (e) {
    trackCapture('save_fail', performance.now() - start, { err: (e as Error).message })
    throw e
  }
}

async function runSave(deps: CreateLogDeps, input: SaveInput): Promise<SaveResult> {
  // 0. 配额预检（EC-CAP-07）：预估写入后占用 >90% 直接拦截
  const usage = await deps.blobStore.usage()
  const incoming = input.photos.reduce((s, p) => s + p.sizeBytes, 0)
  if (usage.quota > 0 && (usage.usage + incoming) / usage.quota > QUOTA_THRESHOLD) {
    throw new StorageQuotaError()
  }

  // 1. 店铺解析：已有 ID 优先 → 按名精确匹配 → 新建
  let restaurant: Restaurant
  if (input.restaurant.existingId) {
    const found = await deps.repos.restaurants.get(input.restaurant.existingId)
    if (!found) throw new Error(`restaurant not found: ${input.restaurant.existingId}`)
    restaurant = found
  } else {
    const name = input.restaurant.name.trim()
    const candidates = await deps.repos.restaurants.search(name, 10)
    const exact = candidates.find((r) => r.name === name)
    restaurant = exact ?? (await deps.repos.restaurants.create({ name }))
  }

  // 2. 图片入 BlobStore（键与 input.photos 下标一一对应）
  const blobKeys: string[] = []
  for (let i = 0; i < input.photos.length; i++) {
    const p = input.photos[i]
    if (!p) continue
    const blob = new Blob([p.buffer], { type: 'image/jpeg' })
    blobKeys.push(await deps.blobStore.put(`cap-${Date.now().toString(36)}-${i}.jpg`, blob))
  }

  // 3. 保存前快照：dish 状态（解锁/追加判定依据）
  const dishBefore = new Map<string, Dish>()
  for (const d of input.dishes) {
    if (d.existingDishId && !dishBefore.has(d.existingDishId)) {
      const found = await deps.repos.dishes.get(d.existingDishId)
      if (found) dishBefore.set(d.existingDishId, found)
    }
  }

  // 4. 逐菜确保 Dish 存在（新菜在事务外建档；打卡事实写入走 addMany 事务）
  const dishIds: string[] = []
  for (const d of input.dishes) {
    if (d.existingDishId) {
      dishIds.push(d.existingDishId)
      continue
    }
    const created = await deps.repos.dishes.create(restaurant.id, {
      name: d.name,
      nameSource: d.nameSource,
      aiSuggestedName: d.aiSuggestedName,
    })
    dishIds.push(created.id)
  }

  // 5. 事务保存（照片元信息 + AI 快照 + tagExtractionState=pending 随 Log 落库）
  const addInputs: AddLogInput[] = input.dishes.map((d, i) => {
    const photos = d.photoIndices.flatMap((idx) => {
      const p = input.photos[idx]
      const key = blobKeys[idx]
      if (!p || !key) return []
      return [{ blobKey: key, width: p.width, height: p.height, sizeBytes: p.sizeBytes }]
    })
    const snapshot: AISnapshot | undefined =
      d.nameSource === 'ai' || d.confidence !== undefined
        ? {
            recognizedName: d.aiSuggestedName ?? d.name,
            confidence: d.confidence ?? 1,
            candidates: d.candidates ?? [],
            modelVendor: input.model?.vendor ?? 'manual',
            modelVersion: input.model?.version ?? '-',
          }
        : undefined
    return {
      dishId: dishIds[i] ?? '',
      restaurantId: restaurant.id,
      rating: d.rating,
      manualAvoid: d.manualAvoid,
      comment: d.comment,
      price: d.price ?? null,
      scene: d.scene,
      ateAt: input.ateAt,
      photos,
      aiSnapshot: snapshot,
    }
  })

  const logs = await deps.repos.logs.addMany(addInputs)

  // 6. 解锁/追加判定（保存前 locked → 保存后 unlocked 即首解；新建档必然首解）
  const unlocked: Dish[] = []
  const appended: Dish[] = []
  for (let i = 0; i < dishIds.length; i++) {
    const id = dishIds[i]
    if (!id) continue
    const after = await deps.repos.dishes.get(id)
    if (!after) continue
    const before = dishBefore.get(id)
    if (!before || (before.status === 'locked' && after.status === 'unlocked')) unlocked.push(after)
    else if (after.status === 'unlocked') appended.push(after)
  }

  // 7. 视图失效 + 异步标签提取（主流程不等标签，TDD §3.3）
  emitDataChanged('log')
  const tagJobIds: string[] = []
  for (const log of logs) {
    tagJobIds.push(await deps.enqueueTags(log.id))
  }

  trackCapture('dish_unlock', { count: unlocked.length })
  trackCapture('dish_append', { count: appended.length })
  return { restaurant, logs, unlocked, appended, tagJobIds }
}
