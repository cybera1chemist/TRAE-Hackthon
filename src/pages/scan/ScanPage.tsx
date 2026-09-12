import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/ui'
import { createAIProvider, type AIErrorCode } from '@/infra/ai'
import { getDataLayer } from '@/application/data/dataLayer'
import { emitDataChanged } from '@/application/data/dataBus'
import type { BBox, Dish, MenuScan, Restaurant } from '@/domain/entities'
import {
  analyzeImagePrecheck,
  applyMatchResults,
  bboxOverlapRatio,
  canConfirmSave,
  computeMenuDiff,
  createInitialDraft,
  cropRegionToDataUrl,
  groupMenuLines,
  makeDishMatcher,
  pendingLowConfidence,
  saveScan,
  scanDraftReducer,
  toLineDrafts,
  validateImageFiles,
  type MenuDiff,
  type MenuLineDraft,
  type ScanEvent,
  type ScanImageSlot,
  type SaveScanResult,
  type UnreadableRegion,
} from '@/features/scan-menu'

/**
 * /scan/:rid? 页面（T3-01/03/04/05/08）：
 * - 店铺选择/新建（无 :rid 时）；多图 ≤10/张 ≤10MB；blur/glare/tooDark 预检提示（EC-MENU-01/02）；
 * - OCR 走 createAIProvider（VITE_AI_MODE=mock/bff/direct）；
 * - 识别结果经 applyMatchResults 接 Agent-1 matchDish（exact 自动关联可撤销 / fuzzy 须确认 / new 决议），
 *   并用 computeMenuDiff 出增量摘要（EC-MENU-05，仅确认差异）；
 * - 确认页（T3-03）：分区折叠 + 其他区（酒水/茶位）默认折叠（EC-MENU-04）、菜名/价格行内编辑、
 *   不可读区块框选重扫（RESCAN_MERGE 替换重叠行）、手添行、低置信（<0.5）决议门禁；
 * - 增量确认（T3-06）：实时 diff 差异卡，消失菜默认保留、勾选才删除（EC-MENU-05），
 *   改名候选仅提示、user 菜名不覆盖（EC-MENU-06）；上传页展示扫描历史；
 * - 保存落库走 saveScan workflow（upsertFromOcr + BlobStore）。
 */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取图片失败: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

/** 置信度色档（PRD EC-MENU：<0.5 强制处理 / 0.5–0.8 关注 / 其余正常） */
function lineTone(line: MenuLineDraft): string {
  if (line.kind !== 'dish') return 'text-ink-muted'
  if (line.confidence < 0.5) return 'text-avoid'
  if (line.confidence < 0.8) return 'text-gold'
  return 'text-ink-muted'
}

/** 匹配结果徽标（T3-04：exact 自动关联 / fuzzy 须确认 / new 新菜） */
function matchBadge(line: MenuLineDraft): string | null {
  if (line.kind !== 'dish') return null
  if (line.match.type === 'exact') return '已关联'
  if (line.match.type === 'fuzzy') return `疑似同款 ${Math.round((line.match.score ?? 0) * 100)}%`
  if (line.match.type === 'new') return '新菜'
  return null
}

const REJECT_REASON_TEXT: Record<string, string> = {
  TYPE_UNSUPPORTED: '格式不支持',
  SIZE_EXCEEDED: '单张超过 10MB',
  COUNT_EXCEEDED: '超过 10 张上限',
}

/** 确认页行卡（T3-03）：菜名/价格行内编辑 + 决议操作；低置信色档（EC-MENU） */
function LineCard({ line, dispatch }: { line: MenuLineDraft; dispatch: Dispatch<ScanEvent> }) {
  const deleted = line.decision === 'deleted'
  const badge = matchBadge(line)
  const candidates = line.match.candidates
  return (
    <li
      className={`rounded-lg border border-line bg-bg p-2 text-sm ${deleted ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <input
          value={line.name}
          aria-label="菜名"
          disabled={deleted}
          className="min-w-0 flex-1 bg-transparent outline-none"
          onChange={(e) =>
            dispatch({ type: 'EDIT_LINE', lineKey: line.lineKey, patch: { name: e.target.value } })
          }
        />
        <span className={`shrink-0 ${lineTone(line)}`}>
          {badge ? `${badge} · ` : ''}
          {line.confidence.toFixed(2)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="min-w-0 truncate">{line.spec ?? ''}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          ¥
          <input
            type="number"
            inputMode="decimal"
            aria-label="价格"
            disabled={deleted}
            defaultValue={line.price ?? ''}
            onBlur={(e) =>
              dispatch({
                type: 'EDIT_LINE',
                lineKey: line.lineKey,
                patch: { price: e.target.value.trim() === '' ? null : Number(e.target.value) },
              })
            }
            className="w-16 rounded border border-line bg-surface px-1 py-0.5 text-right text-xs outline-none focus:border-primary"
          />
        </span>
      </div>
      {line.match.type === 'fuzzy' && candidates != null && candidates.length > 0 && (
        <p className="mt-1 text-xs text-gold">相似菜品：{candidates.join('、')}</p>
      )}
      <div className="mt-1 flex justify-end gap-3 text-xs text-primary">
        {deleted ? (
          <button
            type="button"
            onClick={() =>
              dispatch({ type: 'SET_DECISION', lineKey: line.lineKey, decision: 'keptSeparate' })
            }
          >
            恢复
          </button>
        ) : (
          <>
            <button
              type="button"
              className="text-avoid"
              onClick={() => dispatch({ type: 'DELETE_LINE', lineKey: line.lineKey })}
            >
              删除
            </button>
            {line.match.type === 'fuzzy' && (
              <button
                type="button"
                className="text-gold"
                onClick={() =>
                  dispatch({ type: 'SET_DECISION', lineKey: line.lineKey, decision: 'merged' })
                }
              >
                合并到相似菜
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                dispatch({ type: 'SET_DECISION', lineKey: line.lineKey, decision: 'keptSeparate' })
              }
            >
              {line.match.type === 'exact' && line.decision === 'linked'
                ? '取消关联'
                : '保留为新菜'}
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: 'SET_DECISION', lineKey: line.lineKey, decision: 'ignored' })
              }
            >
              忽略
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * 框选重扫面板（EC-MENU-04）：按原图方向展示（AI 输入未旋转），拖拽框选区域 →
 * onConfirm(imageIndex, region)；不可读区块以虚线框标出。
 */
function RescanPanel({
  images,
  unreadable,
  busy,
  error,
  onConfirm,
}: {
  images: ScanImageSlot[]
  unreadable: UnreadableRegion[]
  busy: boolean
  error: string | null
  onConfirm: (imageIndex: number, region: BBox) => void
}) {
  const [idx, setIdx] = useState(0)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<BBox | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  if (images.length === 0) return null
  const clamped = Math.min(idx, images.length - 1)
  const img = images[clamped]
  const pct = (v: number, total: number) => `${(v / total) * 100}%`
  const toNatural = (clientX: number, clientY: number) => {
    const el = boxRef.current
    if (!el || !natural) return null
    const r = el.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * natural.w,
      y: ((clientY - r.top) / r.height) * natural.h,
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">识别不全？在图上框选区域重扫</p>
        {unreadable.length > 0 && (
          <span className="rounded bg-avoid/10 px-2 py-0.5 text-xs text-avoid">
            {unreadable.length} 个不可读区块（虚线框）
          </span>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-1 overflow-x-auto">
          {images.map((im, i) => (
            <button
              key={im.id}
              type="button"
              aria-label={`切换到第 ${i + 1} 张`}
              className={`relative h-12 w-9 shrink-0 overflow-hidden rounded border ${
                i === clamped ? 'border-primary' : 'border-line'
              }`}
              onClick={() => {
                setIdx(i)
                setRect(null)
                setStart(null)
              }}
            >
              <img src={im.previewUrl} alt="" className="h-full w-full object-cover" />
              {unreadable.some((u) => u.imageIndex === i) && (
                <span className="absolute top-0 right-0 bg-avoid px-0.5 text-[9px] text-white">
                  !
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div
        ref={boxRef}
        className={`relative touch-none ${busy ? 'opacity-60' : ''}`}
        onPointerDown={(e) => {
          if (busy) return
          const p = toNatural(e.clientX, e.clientY)
          if (!p) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setStart(p)
          setRect({ x: p.x, y: p.y, w: 0, h: 0 })
        }}
        onPointerMove={(e) => {
          if (!start) return
          const p = toNatural(e.clientX, e.clientY)
          if (!p || !start) return
          setRect({
            x: Math.min(start.x, p.x),
            y: Math.min(start.y, p.y),
            w: Math.abs(p.x - start.x),
            h: Math.abs(p.y - start.y),
          })
        }}
        onPointerUp={() => {
          setStart(null)
          // 过小视为误触，放弃框选
          if (rect && natural && (rect.w < natural.w * 0.02 || rect.h < natural.h * 0.02)) {
            setRect(null)
          }
        }}
      >
        <img
          src={img.previewUrl}
          alt={`菜单图 ${clamped + 1}`}
          draggable={false}
          className="w-full select-none"
          onLoad={(e) =>
            setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        />
        {natural &&
          unreadable
            .filter((u) => u.imageIndex === clamped)
            .map((u, i) => (
              <div
                key={i}
                className="pointer-events-none absolute border-2 border-dashed border-avoid bg-avoid/10"
                style={{
                  left: pct(u.bbox.x, natural.w),
                  top: pct(u.bbox.y, natural.h),
                  width: pct(u.bbox.w, natural.w),
                  height: pct(u.bbox.h, natural.h),
                }}
              />
            ))}
        {rect && natural && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/10"
            style={{
              left: pct(rect.x, natural.w),
              top: pct(rect.y, natural.h),
              width: pct(rect.w, natural.w),
              height: pct(rect.h, natural.h),
            }}
          />
        )}
      </div>
      {error && <p className="text-xs text-avoid">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1"
          disabled={busy || !rect}
          onClick={() => setRect(null)}
        >
          清除框选
        </Button>
        <Button
          className="flex-1"
          disabled={busy || !rect}
          onClick={() => rect && onConfirm(clamped, rect)}
        >
          {busy ? '重扫中…' : '重扫此区域'}
        </Button>
      </div>
    </div>
  )
}

/** 扫描历史（T3-06 / EC-MENU-05）：选中店铺后展示历史扫描记录，预告增量模式 */
function ScanHistory({ restaurantId }: { restaurantId: string }) {
  const [scans, setScans] = useState<MenuScan[] | null>(null)

  useEffect(() => {
    let alive = true
    void getDataLayer()
      .then((layer) => layer.repos.menuScans.listByRestaurant(restaurantId))
      .then((rows) => {
        if (alive) setScans(rows)
      })
      .catch(() => {
        if (alive) setScans([])
      })
    return () => {
      alive = false
    }
  }, [restaurantId])

  if (scans == null || scans.length === 0) return null
  const recent = [...scans]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5)

  return (
    <div className="space-y-1 rounded-xl border border-line bg-surface p-3">
      <p className="text-sm font-medium">扫描历史</p>
      <ul className="space-y-1 text-xs text-ink-muted">
        {recent.map((s) => (
          <li key={s.id}>
            {new Date(s.createdAt).toLocaleString('zh-CN', { hour12: false })} ·{' '}
            {s.isIncremental ? '增量' : '首扫'} ·{' '}
            {s.status === 'confirmed' ? '已确认' : s.status === 'discarded' ? '已放弃' : '未完成'}
            {s.diffSummary
              ? ` · 新增${s.diffSummary.added}/消失${s.diffSummary.removed}/改名${s.diffSummary.renamed}`
              : ''}
          </li>
        ))}
      </ul>
      <p className="text-xs text-gold">再次扫描将进入增量模式：只确认差异，旧菜默认保留。</p>
    </div>
  )
}

/** 增量差异确认卡（T3-06 / EC-MENU-05/06）：仅确认差异；旧菜默认保留，勾选才删除 */
function DiffConfirmCard({
  diff,
  removedConfirm,
  onToggleRemoved,
}: {
  diff: MenuDiff
  removedConfirm: Set<string>
  onToggleRemoved: (dishId: string) => void
}) {
  const { summary, removed, renamed } = diff
  if (summary.added === 0 && summary.removed === 0 && summary.renamed === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface p-2 text-xs text-ink-muted">
        与现有菜单一致，无差异。
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-2 text-xs">
      <p className="text-ink-muted">
        增量模式：新增 {summary.added} · 消失 {summary.removed}（默认保留） · 改名 {summary.renamed}
      </p>
      {removed.length > 0 && (
        <div className="space-y-1">
          <p className="text-ink-muted">本次扫描未出现的现存菜：</p>
          <ul className="space-y-1">
            {removed.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{d.name}</span>
                <label className="flex shrink-0 items-center gap-1">
                  <input
                    type="checkbox"
                    checked={removedConfirm.has(d.id)}
                    onChange={() => onToggleRemoved(d.id)}
                  />
                  确认已下架并删除
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {renamed.length > 0 && (
        <p className="text-ink-muted">
          可能改名：{renamed.map((r) => `${r.dish.name} → ${r.suggestedName}`).join('；')}。
          在上方对应行选「合并到相似菜」即可生效；人工改过的菜名不会被 AI 覆盖（EC-MENU-06）。
        </p>
      )}
    </div>
  )
}

/** 店铺选择/新建（T3-01）：联想搜索 + 无结果时新建；选中后写入草稿（不动 URL，避免重挂载丢草稿） */
function RestaurantPicker({ onPicked }: { onPicked: (id: string) => void }) {
  const [kw, setKw] = useState('')
  const [results, setResults] = useState<Restaurant[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const k = kw.trim()
    if (!k) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      void getDataLayer()
        .then((layer) => layer.repos.restaurants.search(k, 5))
        .then(setResults)
        .catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [kw])

  const createNew = async () => {
    const name = kw.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const layer = await getDataLayer()
      const created = await layer.repos.restaurants.create({ name })
      onPicked(created.id)
    } finally {
      setBusy(false)
    }
  }

  const hasExact = results.some((r) => r.name === kw.trim())

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <p className="text-sm font-medium text-ink">先选择店铺</p>
      <input
        value={kw}
        onChange={(e) => setKw(e.target.value)}
        placeholder="输入店铺名/别名搜索，或直接输入新店名"
        aria-label="店铺名称"
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
      />
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-bg"
                onClick={() => onPicked(r.id)}
              >
                {r.name}
                {r.city ? <span className="ml-1 text-xs text-ink-muted">{r.city}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {kw.trim() && !hasExact && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={() => void createNew()}
        >
          新建店铺「{kw.trim()}」
        </Button>
      )}
    </div>
  )
}

export function Component() {
  const { rid } = useParams()
  const [draft, dispatch] = useReducer(scanDraftReducer, undefined, () => createInitialDraft(rid))
  const filesRef = useRef(new Map<string, File>())
  const [rejectNotice, setRejectNotice] = useState<string | null>(null)
  // 框选重扫（EC-MENU-04）：匹配基准与首扫一致（同店现存菜品），重扫序号保证 lineKey 唯一
  const existingRef = useRef<Dish[]>([])
  const rescanSeqRef = useRef(0)
  const [rescanBusy, setRescanBusy] = useState(false)
  const [rescanError, setRescanError] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(['other']))
  // 增量确认（T3-06 / EC-MENU-05）：消失菜默认保留，勾选确认后才随保存删除
  const [removedConfirm, setRemovedConfirm] = useState<Set<string>>(() => new Set())
  /** 实时差异（随行编辑重算）；existingRef 在 OCR 时填充 */
  const liveDiff = useMemo(
    () => computeMenuDiff(draft.lines, existingRef.current, makeDishMatcher()),
    [draft.lines],
  )

  const onPickFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      const all = Array.from(files)
      const validations = validateImageFiles(
        all.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        draft.images.length,
      )
      const rejected = validations.filter((v) => !v.ok)
      setRejectNotice(
        rejected.length > 0
          ? `已拒绝 ${rejected.length} 张：${[...new Set(rejected.map((v) => REJECT_REASON_TEXT[v.reason ?? '']))].join('、')}`
          : null,
      )
      const slots: ScanImageSlot[] = validations
        .filter((v) => v.ok)
        .map((v) => {
          const file = all[v.index]
          const slot: ScanImageSlot = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            previewUrl: URL.createObjectURL(file),
            sizeBytes: file.size,
            fileName: file.name,
            precheck: { blur: false, glare: false, tooDark: false },
            rotation: 0,
          }
          filesRef.current.set(slot.id, file)
          return slot
        })
      if (slots.length === 0) return
      dispatch({ type: 'ADD_IMAGES', slots })
      // 像素级预检（blur/glare/tooDark）异步补齐（EC-MENU-02 提示性，不阻塞）
      for (const slot of slots) {
        const file = filesRef.current.get(slot.id)
        if (!file) continue
        void analyzeImagePrecheck(file).then(({ blur, glare, tooDark, width, height }) => {
          dispatch({
            type: 'UPDATE_PRECHECK',
            imageId: slot.id,
            precheck: { blur, glare, tooDark },
            width,
            height,
          })
        })
      }
    },
    [draft.images.length],
  )

  const removeImage = useCallback((imageId: string) => {
    filesRef.current.delete(imageId)
    dispatch({ type: 'REMOVE_IMAGE', imageId })
  }, [])

  const pickRestaurant = useCallback((id: string) => {
    dispatch({ type: 'SELECT_RESTAURANT', restaurantId: id })
  }, [])

  const onStartOcr = useCallback(async () => {
    const files = draft.images
      .map((img) => filesRef.current.get(img.id))
      .filter((f): f is File => f != null)
    if (files.length === 0) return
    dispatch({ type: 'START_OCR' })
    setRemovedConfirm(new Set())
    try {
      const [layer, images] = await Promise.all([
        getDataLayer(),
        Promise.all(files.map(fileToDataUrl)),
      ])
      // 匹配范围仅同店（TDD §3.4）：以本店现存菜品为基准做关联与增量 diff
      const existing = draft.restaurantId
        ? await layer.repos.dishes.listByRestaurant(draft.restaurantId)
        : []
      existingRef.current = existing
      const resp = await createAIProvider().scanMenu({ images, restaurantId: draft.restaurantId })
      const { lines, unreadable } = toLineDrafts(resp)
      const matched = applyMatchResults(lines, existing)
      const diff = computeMenuDiff(matched, existing, makeDishMatcher())
      dispatch({
        type: 'OCR_SUCCESS',
        lines: matched,
        unreadable,
        isIncremental: existing.length > 0,
        diffSummary: diff.summary,
      })
    } catch (err) {
      const error = err as { code?: AIErrorCode; retriable?: boolean; message?: string }
      dispatch({
        type: 'OCR_FAILURE',
        error: {
          code: error.code ?? 'UNKNOWN',
          retriable: error.retriable ?? false,
          message: error.message,
        },
      })
    }
  }, [draft.images, draft.restaurantId])

  /** 框选重扫（EC-MENU-04）：裁剪区域 → scanMenu → 匹配 → RESCAN_MERGE 替换重叠行 */
  const onRescanRegion = useCallback(
    async (imageIndex: number, region: BBox) => {
      if (rescanBusy) return
      const file = filesRef.current.get(draft.images[imageIndex]?.id ?? '')
      if (!file) {
        setRescanError('原图缺失，无法重扫该区域')
        return
      }
      setRescanBusy(true)
      setRescanError(null)
      try {
        const cropped = await cropRegionToDataUrl(file, region)
        const resp = await createAIProvider().scanMenu({
          images: [cropped],
          restaurantId: draft.restaurantId,
        })
        const { lines, unreadable } = toLineDrafts(resp)
        rescanSeqRef.current += 1
        const remapped = lines.map((l, i) => ({
          ...l,
          lineKey: `temp-rescan-${rescanSeqRef.current}-${i}`,
          imageIndex,
          rescanOf: region,
        }))
        const matched = applyMatchResults(remapped, existingRef.current)
        // 与 reducer 相同口径（重叠 ≥0.5）预估替换后的行集合，用于重算增量摘要
        const replacedKeys = new Set(
          draft.lines
            .filter(
              (l) =>
                l.imageIndex === imageIndex &&
                l.bbox != null &&
                bboxOverlapRatio(region, l.bbox) >= 0.5,
            )
            .map((l) => l.lineKey),
        )
        const nextLines = [...draft.lines.filter((l) => !replacedKeys.has(l.lineKey)), ...matched]
        const diff = computeMenuDiff(nextLines, existingRef.current, makeDishMatcher())
        dispatch({
          type: 'RESCAN_MERGE',
          imageIndex,
          region,
          lines: matched,
          unreadable,
          diffSummary: diff.summary,
        })
      } catch (err) {
        setRescanError(err instanceof Error ? err.message : '重扫失败，请重试')
      } finally {
        setRescanBusy(false)
      }
    },
    [draft, rescanBusy],
  )

  const pending = pendingLowConfidence(draft)
  const [saveResult, setSaveResult] = useState<SaveScanResult | null>(null)
  const warnedImages = draft.images.filter(
    (img) => img.precheck.blur || img.precheck.glare || img.precheck.tooDark,
  )

  /** 保存落库（T3-05/08 workflow）：失败 SAVE_FAILURE 回 confirm，草稿不丢；
   *  勾选删除的消失菜与当前 diff.removed 求交（编辑决议后可能重新匹配上，防止误删） */
  const onSave = useCallback(async () => {
    dispatch({ type: 'START_SAVING' })
    try {
      const layer = await getDataLayer()
      const images = draft.images
        .map((img) => {
          const file = filesRef.current.get(img.id)
          return file ? { imageId: img.id, file, width: img.width, height: img.height } : null
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
      const confirmedRemovedDishIds = [...removedConfirm].filter((id) =>
        liveDiff.removed.some((d) => d.id === id),
      )
      const result = await saveScan(
        { repos: layer.repos, blobStore: layer.blobStore },
        { draft, images, confirmedRemovedDishIds },
      )
      setSaveResult(result)
      emitDataChanged('dish')
      dispatch({ type: 'SAVE_SUCCESS' })
    } catch (err) {
      dispatch({ type: 'SAVE_FAILURE', message: err instanceof Error ? err.message : '保存失败' })
    }
  }, [draft, removedConfirm, liveDiff])

  return (
    <div className="min-h-dvh bg-bg p-4 pb-24 text-ink">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-lg font-semibold">菜单扫描</h1>
        <span className="text-xs text-ink-muted">
          {draft.isIncremental ? '增量模式' : '首扫'} · {draft.phase}
        </span>
      </header>

      {draft.phase !== 'confirm' && draft.phase !== 'saving' && draft.phase !== 'done' && (
        <section className="space-y-3">
          {!draft.restaurantId && <RestaurantPicker onPicked={pickRestaurant} />}
          {draft.restaurantId && <ScanHistory restaurantId={draft.restaurantId} />}

          <label className="block cursor-pointer rounded-xl border border-dashed border-line bg-surface p-6 text-center text-sm">
            拍照 / 选择菜单图片（≤10 张，单张 ≤10MB）
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </label>
          {rejectNotice && <p className="text-xs text-avoid">{rejectNotice}</p>}
          <ul className="grid grid-cols-3 gap-2">
            {draft.images.map((img) => (
              <li key={img.id} className="relative overflow-hidden rounded-lg border border-line">
                <img
                  src={img.previewUrl}
                  alt={img.fileName}
                  style={{ transform: `rotate(${img.rotation}deg)` }}
                  className="aspect-[3/4] w-full object-cover"
                />
                {(img.precheck.blur || img.precheck.glare || img.precheck.tooDark) && (
                  <span className="absolute top-1 left-1 rounded bg-avoid/90 px-1 text-[10px] text-white">
                    {[
                      img.precheck.blur && '模糊',
                      img.precheck.glare && '反光',
                      img.precheck.tooDark && '过暗',
                    ]
                      .filter(Boolean)
                      .join('/')}
                  </span>
                )}
                <button
                  type="button"
                  className="absolute top-1 right-1 rounded bg-black/60 px-1 text-xs text-white"
                  onClick={() => removeImage(img.id)}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="absolute right-1 bottom-1 rounded bg-black/60 px-1 text-xs text-white"
                  onClick={() => dispatch({ type: 'ROTATE_IMAGE', imageId: img.id })}
                >
                  旋转
                </button>
              </li>
            ))}
          </ul>
          {warnedImages.length > 0 && (
            <p className="rounded-lg border border-avoid/40 bg-avoid/10 p-2 text-xs text-avoid">
              {warnedImages.length}{' '}
              张图片清晰度欠佳（模糊/反光/过暗），建议正对菜单、避免阴影后重拍；
              也可继续识别，识别差的区域可框选重扫。
            </p>
          )}
          {draft.ocrError && (
            <>
              <p className="text-sm text-avoid">
                识别失败（{draft.ocrError.code}），可重试或改为手录。
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => dispatch({ type: 'ENTER_MANUAL' })}
              >
                改为手动录入
              </Button>
            </>
          )}
          <Button
            className="w-full"
            disabled={draft.images.length === 0 || draft.phase === 'ocr'}
            onClick={() => void onStartOcr()}
          >
            {draft.phase === 'ocr' ? '识别中…' : '开始识别'}
          </Button>
        </section>
      )}

      {(draft.phase === 'confirm' || draft.phase === 'saving') && (
        <section className="space-y-3">
          {draft.isIncremental && liveDiff && (
            <DiffConfirmCard
              diff={liveDiff}
              removedConfirm={removedConfirm}
              onToggleRemoved={(dishId) =>
                setRemovedConfirm((prev) => {
                  const next = new Set(prev)
                  if (next.has(dishId)) next.delete(dishId)
                  else next.add(dishId)
                  return next
                })
              }
            />
          )}
          {pending.length > 0 && (
            <p className="rounded-lg border border-avoid/40 bg-avoid/10 p-2 text-sm text-avoid">
              {pending.length} 行低置信（&lt;0.5）需逐行确认后才能保存。
            </p>
          )}
          <RescanPanel
            images={draft.images}
            unreadable={draft.unreadable}
            busy={rescanBusy}
            error={rescanError}
            onConfirm={(imageIndex, region) => void onRescanRegion(imageIndex, region)}
          />
          {groupMenuLines(draft.lines).map((group) => {
            const isCollapsed = collapsedGroups.has(group.key)
            return (
              <div key={group.key} className="rounded-xl border border-line bg-surface">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
                  onClick={() =>
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev)
                      if (next.has(group.key)) next.delete(group.key)
                      else next.add(group.key)
                      return next
                    })
                  }
                >
                  <span>
                    {group.title}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {group.lines.length} 行
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted">{isCollapsed ? '展开' : '收起'}</span>
                </button>
                {!isCollapsed && (
                  <ul className="space-y-2 border-t border-line p-2">
                    {group.lines.map((line) => (
                      <LineCard key={line.lineKey} line={line} dispatch={dispatch} />
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => dispatch({ type: 'ADD_MANUAL_LINE' })}
          >
            手动添加一行
          </Button>
          {draft.saveError && (
            <p className="rounded-lg border border-avoid/40 bg-avoid/10 p-2 text-sm text-avoid">
              保存失败：{draft.saveError}（草稿已保留，可重试）
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => dispatch({ type: 'BACK', to: 'preview' })}
            >
              返回重扫
            </Button>
            <Button
              className="flex-1"
              disabled={!canConfirmSave(draft) || draft.lines.length === 0}
              onClick={() => void onSave()}
            >
              {draft.phase === 'saving' ? '保存中…' : '保存到图鉴'}
            </Button>
          </div>
        </section>
      )}

      {draft.phase === 'done' && (
        <section className="space-y-4 text-center">
          <p className="text-sm">
            已保存到图鉴
            {saveResult
              ? `：新建 ${saveResult.createdDishIds.length} · 关联 ${saveResult.linkedDishIds.length}`
              : ''}
            。
          </p>
          <Button
            onClick={() => {
              setRemovedConfirm(new Set())
              dispatch({ type: 'DISCARD' })
            }}
          >
            再扫一次
          </Button>
        </section>
      )}
    </div>
  )
}
