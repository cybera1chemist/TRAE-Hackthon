import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, ScanLine, Trash2, TriangleAlert } from 'lucide-react'
import { Button, Dialog, LoadingButton, useToast } from '@/ui'
import type { Dish, Restaurant } from '@/domain/entities'
import { checkMime } from '@/features/capture/image/validate'
import { compressImage, type CompressedImage } from '@/features/capture/image/compress'
import {
  buildConfirmRows,
  draftToRows,
  recognizeDishes,
  type ConfirmDishRow,
} from '@/features/capture/recognize'
import {
  createLogWorkflow,
  StorageQuotaError,
  type SaveResult,
} from '@/features/capture/createLogWorkflow'
import { getCaptureRuntime, makeTagEnqueuer } from '@/features/capture/runtime'
import {
  clearCaptureDraft,
  isDraftRestorable,
  loadCaptureDraft,
  saveCaptureDraft,
} from '@/features/capture/draft'
import { trackCapture } from '@/features/capture/analytics'
import { CameraCapture } from './CameraCapture'
import { ConfirmStep } from './ConfirmStep'
import { DoneStep } from './DoneStep'

const MAX_PHOTOS = 9

type Step = 'pick' | 'confirm' | 'done'

interface Slot {
  id: string
  previewUrl: string
  status: 'compressing' | 'ready' | 'error'
  compressed?: CompressedImage
}

/**
 * /capture 打卡流程页（T1-07/T2-03/04/05/07/08 主链路）：
 * pick（相机/相册 ≤9 张 + worker 压缩 + blur 预检）→ 识别（可取消、15s 降级）→
 * confirm（三档置信确认 + 附加信息 + 店铺联想 + 草稿 24h）→ 保存事务 →
 * done（解锁动效 + 追加态 + 标签回填确认）。
 */
export default function CapturePage() {
  const toast = useToast()

  const [step, setStep] = useState<Step>('pick')
  const [slots, setSlots] = useState<Slot[]>([])
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [rows, setRows] = useState<ConfirmDishRow[]>([])
  const [restaurant, setRestaurant] = useState<{ existingId?: string; name: string }>({ name: '' })
  const [suggestions, setSuggestions] = useState<Restaurant[]>([])
  const [existingDishes, setExistingDishes] = useState<Dish[]>([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<SaveResult | null>(null)
  const [memoryMode, setMemoryMode] = useState(false)
  const [draftOffer, setDraftOffer] = useState<ReturnType<typeof loadCaptureDraft>>(null)
  const [aiModel, setAiModel] = useState<{ vendor: string; version: string } | undefined>(undefined)

  const abortRef = useRef<AbortController | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** slots 镜像（事件回调里读当前值，避免 setState updater 内做副作用） */
  const slotsRef = useRef<Slot[]>([])
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  /** 压缩任务用的原始 File（slot.id → File） */
  const slotFileRefs = useRef(new Map<string, File>())

  // ── 初始化：runtime + 草稿恢复检查 ──────────────────────────────────────────
  useEffect(() => {
    let alive = true
    void getCaptureRuntime().then((rt) => {
      if (alive) setMemoryMode(rt.mode === 'memory')
    })
    const draft = loadCaptureDraft()
    if (draft && isDraftRestorable(draft.draft)) setDraftOffer(draft)
    return () => {
      alive = false
    }
  }, [])

  // ── 图片添加与压缩（T1-08/T2-07） ───────────────────────────────────────────
  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const accepted: Slot[] = []
      let remaining = MAX_PHOTOS - slotsRef.current.length
      for (const file of files) {
        if (remaining <= 0) {
          toast({ title: `一次最多 ${MAX_PHOTOS} 张图片`, variant: 'info' })
          break
        }
        const mime = checkMime(file.type)
        if (mime === 'heic') {
          toast({
            title: 'HEIC 格式请先转换为 JPG',
            description: '或改用系统相册导出',
            variant: 'info',
          })
          continue
        }
        if (mime === 'unsupported') {
          toast({ title: '仅支持 JPG / PNG / WebP', variant: 'error' })
          continue
        }
        remaining -= 1
        const slot: Slot = {
          id: `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          previewUrl: URL.createObjectURL(file),
          status: 'compressing',
        }
        slotFileRefs.current.set(slot.id, file)
        accepted.push(slot)
      }
      if (accepted.length === 0) return
      setSlots((prev) => [...prev, ...accepted])
      for (const slot of accepted) {
        const file = slotFileRefs.current.get(slot.id)
        if (!file) continue
        void compressImage(file)
          .then((compressed) => {
            trackCapture('photo_compress', {
              sizeBytes: compressed.sizeBytes,
              blur: compressed.blur,
            })
            setSlots((cur) =>
              cur.map((s) => (s.id === slot.id ? { ...s, status: 'ready', compressed } : s)),
            )
          })
          .catch((e: unknown) => {
            toast({
              title: '图片处理失败，请重新选择',
              description: (e as Error)?.message,
              variant: 'error',
            })
            setSlots((cur) => cur.map((s) => (s.id === slot.id ? { ...s, status: 'error' } : s)))
          })
      }
    },
    [toast],
  )

  const removeSlot = (id: string) => {
    slotFileRefs.current.delete(id)
    setSlots((prev) => {
      const target = prev.find((s) => s.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((s) => s.id !== id)
    })
  }

  const resetAll = () => {
    slots.forEach((s) => URL.revokeObjectURL(s.previewUrl))
    slotFileRefs.current.clear()
    setSlots([])
    setRows([])
    setDegraded(false)
    setRestaurant({ name: '' })
    setSuggestions([])
    setExistingDishes([])
    setResult(null)
    setAiModel(undefined)
    setStep('pick')
  }

  // ── 店铺联想（T1-07，防抖搜索） ─────────────────────────────────────────────
  const searchRestaurant = useCallback((keyword: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const kw = keyword.trim()
    if (!kw) {
      setSuggestions([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const rt = await getCaptureRuntime()
        setSuggestions(await rt.repos.restaurants.search(kw, 5))
      } catch {
        setSuggestions([])
      }
    }, 200)
  }, [])

  // 选定已有店铺 → 拉取同店菜品（EC-CAP-13 匹配徽标）
  useEffect(() => {
    if (!restaurant.existingId) {
      setExistingDishes([])
      return
    }
    let alive = true
    void getCaptureRuntime()
      .then((rt) => rt.repos.dishes.listByRestaurant(restaurant.existingId as string))
      .then((list) => {
        if (alive) setExistingDishes(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [restaurant.existingId])

  // ── 识别编排（T2-04 识别侧：可取消 + 15s 降级） ─────────────────────────────
  const startRecognize = useCallback(async () => {
    const ready = slots.filter((s) => s.status === 'ready' && s.compressed)
    if (ready.length === 0) return
    setRecognizing(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const rt = await getCaptureRuntime()
      const outcome = await recognizeDishes(
        rt.ai,
        ready.map((s) => s.compressed?.blob ?? new ArrayBuffer(0)),
        controller.signal,
        restaurant.existingId ? { restaurantId: restaurant.existingId } : undefined,
      )
      if (outcome.ok) {
        setAiModel(outcome.resp.model)
        const built = buildConfirmRows(outcome.resp, existingDishes)
        setRows(built)
        setDegraded(false)
        if (built.length === 0) {
          toast({
            title: '未识别到菜品',
            description: '已进入手动录入，图片将保留为打卡配图',
            variant: 'info',
          })
        }
        setStep('confirm')
      } else if (outcome.reason === 'TIMEOUT') {
        // 15s 未返回 / AI 故障 → 降级手动录入（图片与草稿保留，EC-CAP-06）
        setRows([])
        setDegraded(true)
        setStep('confirm')
        toast({
          title: 'AI 识别超时',
          description: '已切换为手动录入，可随时点「重试识别」',
          variant: 'info',
        })
      }
      // ABORTED（用户取消）：留在拍照步，图片保留
    } finally {
      setRecognizing(false)
      abortRef.current = null
    }
  }, [slots, existingDishes, restaurant.existingId, toast])

  // ── 草稿（T1-07：确认页状态变更即存，24h 有效） ─────────────────────────────
  useEffect(() => {
    if (step !== 'confirm') return
    saveCaptureDraft({
      restaurantName: restaurant.name,
      degraded,
      dishes: rows.map((r) => ({
        name: r.name,
        nameSource: r.nameSource,
        aiSuggestedName: r.aiName || undefined,
        confidence: r.confidence,
        candidates: r.candidates,
        rating: r.rating,
        manualAvoid: r.manualAvoid,
        comment: r.comment || undefined,
        price: r.price,
        scene: r.scene || undefined,
      })),
    })
  }, [step, rows, restaurant.name, degraded])

  const restoreDraft = () => {
    if (!draftOffer) return
    const d = draftOffer.draft
    setRows(draftToRows(d.dishes))
    setRestaurant(d.restaurantName ? { name: d.restaurantName } : { name: '' })
    setDegraded(d.degraded)
    setDraftOffer(null)
    setStep('confirm')
  }

  // ── 保存（T2-04 保存侧编排） ────────────────────────────────────────────────
  const save = useCallback(async () => {
    const selected = rows.filter((r) => r.selected)
    if (selected.length === 0 || saving) return
    setSaving(true)
    try {
      const rt = await getCaptureRuntime()
      const photos = slots.flatMap((s) =>
        s.compressed
          ? [
              {
                buffer: s.compressed.blob,
                width: s.compressed.width,
                height: s.compressed.height,
                sizeBytes: s.compressed.sizeBytes,
              },
            ]
          : [],
      )
      const saveResult = await createLogWorkflow(
        { repos: rt.repos, blobStore: rt.blobStore, enqueueTags: makeTagEnqueuer(rt.queue) },
        {
          restaurant: { existingId: restaurant.existingId, name: restaurant.name },
          dishes: selected.map((r) => ({
            name: r.name,
            nameSource: r.nameSource,
            aiSuggestedName: r.aiName && r.aiName !== r.name ? r.aiName : undefined,
            existingDishId: r.match?.type === 'exact' ? r.match.dishId : undefined,
            confidence: r.confidence,
            candidates: r.candidates,
            rating: r.rating,
            manualAvoid: r.manualAvoid,
            comment: r.comment || undefined,
            price: r.price,
            scene: r.scene || undefined,
            photoIndices: r.photoIdx,
          })),
          photos,
          ateAt: new Date().toISOString(),
          model: aiModel,
        },
      )
      clearCaptureDraft()
      setResult(saveResult)
      slots.forEach((s) => URL.revokeObjectURL(s.previewUrl))
      setStep('done')
    } catch (e) {
      if (e instanceof StorageQuotaError) {
        toast({
          title: '存储空间不足',
          description: '请清理旧图片或在设置中导出备份后重试',
          variant: 'error',
        })
      } else {
        toast({ title: '保存失败，请重试', description: (e as Error)?.message, variant: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }, [rows, saving, slots, restaurant, aiModel, toast])

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <>
        <ConfirmStep
          rows={rows}
          onRowsChange={setRows}
          restaurant={restaurant}
          onRestaurantChange={setRestaurant}
          suggestions={suggestions}
          onSearchRestaurant={searchRestaurant}
          degraded={degraded}
          onRetryRecognize={() => void startRecognize()}
          existingDishes={existingDishes}
          saving={saving}
          onSave={() => void save()}
          photoCount={slots.length}
        />
        {recognizing && <RecognizingOverlay onCancel={() => abortRef.current?.abort()} />}
      </>
    )
  }

  if (step === 'done' && result) {
    return <DoneStepWrapper result={result} onContinue={resetAll} />
  }

  // pick 步
  const compressing = slots.some((s) => s.status === 'compressing')
  const canRecognize = slots.length > 0 && !compressing && slots.every((s) => s.status === 'ready')

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-ink">极速打卡</h1>
        <p className="text-sm text-ink-muted">拍下菜品，AI 帮你记进图鉴</p>
      </header>

      {memoryMode && (
        <p className="flex items-start gap-2 rounded-card border border-gold/40 bg-gold/10 p-3 text-sm text-ink">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          当前浏览器不支持本地持久化，数据仅保留到关闭页面，请及时在设置中导出备份
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="primary" onClick={() => setCameraOpen(true)}>
          <Camera className="h-4 w-4" aria-hidden />
          拍照
        </Button>
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" aria-hidden />
          相册上传
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          addFiles(files)
        }}
      />

      {slots.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {slots.map((s, i) => (
            <li
              key={s.id}
              className="relative aspect-square overflow-hidden rounded-card border border-line bg-surface-2"
            >
              <img
                src={s.previewUrl}
                alt={`图片 ${i + 1}`}
                className="h-full w-full object-cover"
              />
              {s.status === 'compressing' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                </div>
              )}
              {s.status === 'ready' && s.compressed?.blur && (
                <span className="absolute bottom-1 left-1 rounded bg-avoid/90 px-1.5 py-0.5 text-[10px] text-white">
                  可能模糊
                </span>
              )}
              <button
                type="button"
                aria-label={`删除图片 ${i + 1}`}
                onClick={() => removeSlot(s.id)}
                className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-2 pb-6">
        <p className="text-center text-xs text-ink-muted">
          {slots.length}/{MAX_PHOTOS} 张 · 长边压缩至 1600px · EXIF 自动纠正
        </p>
        <LoadingButton
          variant="primary"
          loading={false}
          disabled={!canRecognize}
          onClick={() => void startRecognize()}
          className="w-full"
        >
          <ScanLine className="h-4 w-4" aria-hidden />
          开始识别
        </LoadingButton>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => {
            addFiles([file])
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      <Dialog
        open={draftOffer !== null}
        onOpenChange={(open) => {
          if (!open) {
            clearCaptureDraft()
            setDraftOffer(null)
          }
        }}
        title="恢复上次草稿？"
        description={
          draftOffer
            ? `检测到 ${Math.round(draftOffer.ageMs / 60000)} 分钟前的打卡草稿（24 小时内有效）`
            : undefined
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                clearCaptureDraft()
                setDraftOffer(null)
              }}
            >
              忽略
            </Button>
            <Button variant="primary" onClick={restoreDraft}>
              恢复草稿
            </Button>
          </>
        }
      />

      {recognizing && <RecognizingOverlay onCancel={() => abortRef.current?.abort()} />}
    </div>
  )
}

/** 识别中遮罩（T2-08：全程可取消） */
function RecognizingOverlay({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-card bg-surface p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-ink">AI 识别中…</p>
        <p className="text-xs text-ink-muted">超过 15 秒未返回将自动降级为手动录入</p>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}

/** /capture 打卡流程页（react-router lazy 约定导出） */
export function Component() {
  return <CapturePage />
}
function DoneStepWrapper({ result, onContinue }: { result: SaveResult; onContinue: () => void }) {
  const [repos, setRepos] = useState<Parameters<typeof DoneStep>[0]['repos'] | null>(null)
  useEffect(() => {
    void getCaptureRuntime().then((rt) => setRepos(rt.repos))
  }, [])
  if (!repos) return null
  return <DoneStep result={result} repos={repos} onContinue={onContinue} />
}
