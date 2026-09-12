import { useState } from 'react'
import { ChevronDown, CircleAlert, Hand, ScanEye, Sparkles, Undo2, Utensils } from 'lucide-react'
import { Button, Chip, Input, LoadingButton, Stars, Switch, Textarea, cn } from '@/ui'
import type { Dish, Restaurant } from '@/domain/entities'
import { applyAvoidChange, applyRatingChange, pulseAvoidHint } from '@/features/rating/linkage'
import {
  createManualRow,
  recomputeMatches,
  saveButtonLabel,
  type ConfirmDishRow,
} from '@/features/capture/recognize'

export interface ConfirmStepProps {
  rows: ConfirmDishRow[]
  onRowsChange: (rows: ConfirmDishRow[]) => void
  restaurant: { existingId?: string; name: string }
  onRestaurantChange: (next: { existingId?: string; name: string }) => void
  suggestions: Restaurant[]
  onSearchRestaurant: (keyword: string) => void
  /** AI 识别降级（超时/失败）→ 顶部横幅 + 重试入口（EC-CAP-06） */
  degraded: boolean
  onRetryRecognize: () => void
  /** 同店已有菜品（匹配徽标 / 改名后重算） */
  existingDishes: Dish[]
  saving: boolean
  onSave: () => void
  photoCount: number
}

const CONFIDENT_FOLD = 8

/**
 * 识别确认页（T2-03 / EC-CAP-10~14）：置信三档、Top3 候选、勾选/合并/改名/手添、
 * 附加信息（T1-07：星级半星×避雷联动、价格/场景/感想全部可跳过）。
 */
export function ConfirmStep(props: ConfirmStepProps) {
  const { rows, onRowsChange, degraded, onRetryRecognize, saving, onSave, photoCount } = props
  const [showAll, setShowAll] = useState(rows.length <= CONFIDENT_FOLD)
  const [manualName, setManualName] = useState('')

  const visible = showAll ? rows : rows.slice(0, CONFIDENT_FOLD)
  const lows = visible.filter((r) => r.confidence < 0.5)
  const normals = visible.filter((r) => r.confidence >= 0.5)
  const noneSelected = !rows.some((r) => r.selected)

  const patch = (id: string, p: Partial<ConfirmDishRow>) => {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }

  const rename = (id: string, name: string) => {
    onRowsChange(
      recomputeMatches(
        rows.map((r) => (r.id === id ? { ...r, name } : r)),
        props.existingDishes,
      ),
    )
  }

  const undoMerge = (id: string) => {
    const row = rows.find((r) => r.id === id)
    if (!row || row.mergedFrom.length === 0) return
    const splits: ConfirmDishRow[] = [
      { ...row, mergedFrom: [] },
      ...row.mergedFrom.map((name) => ({
        ...createManualRow(name, row.photoIdx),
        nameSource: 'ai' as const,
        aiName: name,
        confidence: row.confidence,
        selected: false,
      })),
    ]
    onRowsChange([...rows.filter((r) => r.id !== id), ...splits])
  }

  const addManual = () => {
    const name = manualName.trim()
    if (!name) return
    onRowsChange([...rows, createManualRow(name)])
    setManualName('')
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4 pb-32">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink">确认识别结果</h1>
        <span className="text-sm text-ink-muted">{photoCount} 张图片</span>
      </header>

      {/* 店铺联想（T1-07） */}
      <section className="rounded-card border border-line bg-surface p-4">
        <label className="text-sm font-medium text-ink" htmlFor="capture-restaurant">
          店铺
        </label>
        <Input
          id="capture-restaurant"
          value={props.restaurant.name}
          placeholder="搜索或输入新店铺名"
          className="mt-2"
          onChange={(e) => {
            props.onRestaurantChange({ name: e.target.value })
            props.onSearchRestaurant(e.target.value)
          }}
        />
        {props.suggestions.length > 0 && (
          <ul className="mt-2 space-y-1">
            {props.suggestions.slice(0, 5).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left text-sm text-ink hover:bg-surface-2"
                  onClick={() => {
                    props.onRestaurantChange({ existingId: r.id, name: r.name })
                  }}
                >
                  <Utensils className="mr-2 inline h-4 w-4 text-ink-muted" aria-hidden />
                  {r.name}
                  {r.district && <span className="ml-1 text-ink-muted">· {r.district}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {!props.restaurant.existingId && props.restaurant.name.trim() && (
          <p className="mt-2 text-xs text-ink-muted">
            保存时将创建新店铺「{props.restaurant.name.trim()}」
          </p>
        )}
      </section>

      {/* 降级横幅（EC-CAP-06） */}
      {degraded && (
        <section className="flex items-center justify-between gap-3 rounded-card border border-gold/40 bg-gold/10 p-3">
          <p className="flex items-center gap-2 text-sm text-ink">
            <CircleAlert className="h-4 w-4 shrink-0 text-gold" aria-hidden />
            AI 识别暂不可用，可手动录入菜名（图片已保留）
          </p>
          <Button variant="secondary" onClick={onRetryRecognize}>
            重试识别
          </Button>
        </section>
      )}

      {/* 主列表：高/中置信 */}
      <ul className="space-y-2">
        {normals.map((r) => (
          <RowCard key={r.id} row={r} onPatch={patch} onRename={rename} onUndoMerge={undoMerge} />
        ))}
      </ul>

      {/* 低置信折叠区（<0.5，「AI 还猜了」） */}
      {lows.length > 0 && (
        <section className="rounded-card border border-dashed border-line p-3">
          <p className="mb-2 flex items-center gap-1 text-sm text-ink-muted">
            <ScanEye className="h-4 w-4" aria-hidden />
            AI 还猜了（低置信，请确认后再勾选）
          </p>
          <ul className="space-y-2">
            {lows.map((r) => (
              <RowCard
                key={r.id}
                row={r}
                onPatch={patch}
                onRename={rename}
                onUndoMerge={undoMerge}
              />
            ))}
          </ul>
        </section>
      )}

      {!showAll && rows.length > CONFIDENT_FOLD && (
        <Button variant="ghost" onClick={() => setShowAll(true)}>
          共识别到 {rows.length} 道，展开其余 {rows.length - CONFIDENT_FOLD} 道
        </Button>
      )}

      {/* 手添（EC-CAP-10/14 兜底） */}
      <section className="flex gap-2">
        <Input
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          placeholder="没识别到？手动输入菜名"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addManual()
            }
          }}
          className="flex-1"
        />
        <Button variant="secondary" onClick={addManual} disabled={!manualName.trim()}>
          <Hand className="h-4 w-4" aria-hidden />
          手添
        </Button>
      </section>

      {/* 底部保存条 */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-xl flex-col gap-1">
          <LoadingButton
            variant="primary"
            loading={saving}
            disabled={noneSelected}
            onClick={onSave}
            className="w-full"
          >
            {saveButtonLabel(rows)}
          </LoadingButton>
          {noneSelected && (
            <p className="text-center text-xs text-ink-muted">
              勾选菜品或手添一道菜后保存；图片将随打卡一并保存
            </p>
          )}
        </div>
      </footer>
    </div>
  )
}

// ── 单行卡片 ─────────────────────────────────────────────────────────────────

function RowCard({
  row,
  onPatch,
  onRename,
  onUndoMerge,
}: {
  row: ConfirmDishRow
  onPatch: (id: string, p: Partial<ConfirmDishRow>) => void
  onRename: (id: string, name: string) => void
  onUndoMerge: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const level = row.confidence >= 0.8 ? 'high' : row.confidence >= 0.5 ? 'medium' : 'low'
  const tone = level === 'high' ? 'text-ink-muted' : level === 'medium' ? 'text-gold' : 'text-avoid'

  return (
    <li
      className={cn(
        'rounded-card border bg-surface p-3',
        level === 'medium' && 'border-gold/40',
        level === 'low' && 'border-line opacity-90',
        level === 'high' && 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={(e) => onPatch(row.id, { selected: e.target.checked })}
          aria-label={`打卡 ${row.name}`}
          className="mt-1 h-5 w-5 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              value={row.name}
              onChange={(e) => onRename(row.id, e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
            />
          ) : (
            <button
              type="button"
              className="block max-w-full truncate text-left text-base font-medium text-ink"
              onClick={() => setEditing(true)}
              aria-label={`修改菜名 ${row.name}`}
            >
              {row.name}
            </button>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn('text-xs', tone)}>
              置信 {Math.round(row.confidence * 100)}%{level === 'medium' && ' · 请确认'}
            </span>
            {row.nameSource === 'ai' && row.aiName && row.aiName !== row.name && (
              <span className="text-xs text-ink-muted">AI 原名：{row.aiName}</span>
            )}
            {row.match && (
              <Chip tone={row.match.type === 'exact' ? 'gold' : 'default'} ariaLabel="已有菜品匹配">
                {row.match.type === 'exact'
                  ? `图鉴中已有 · 第 ${row.match.logCount + 1} 次打卡`
                  : `可能是同一道菜（${Math.round(row.match.score * 100)}%）`}
              </Chip>
            )}
            {row.mergedFrom.length > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-xs text-ink-muted underline"
                onClick={() => onUndoMerge(row.id)}
              >
                <Undo2 className="h-3 w-3" aria-hidden />
                已合并 {row.mergedFrom.length} 项，撤销
              </button>
            )}
          </div>

          {/* Top3 候选（点击换名） */}
          {row.candidates.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.candidates
                .filter((c) => c !== row.name)
                .slice(0, 3)
                .map((c) => (
                  <Chip
                    key={c}
                    tone="ai"
                    onClick={() => onRename(row.id, c)}
                    ariaLabel={`候选 ${c}`}
                  >
                    {c}
                  </Chip>
                ))}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label={detailOpen ? '收起补充信息' : '展开补充信息'}
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((v) => !v)}
          className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2"
        >
          <ChevronDown
            className={cn('h-4 w-4 transition', detailOpen && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>

      {detailOpen && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-3">
            <Stars
              value={row.rating ?? 0}
              size="md"
              ariaLabel={`${row.name} 评分`}
              onChange={(v) => {
                const next = applyRatingChange(
                  { rating: row.rating, manualAvoid: row.manualAvoid },
                  v === 0 ? null : v,
                )
                if (next.autoAvoidTriggered) pulseAvoidHint()
                onPatch(row.id, { rating: next.rating, manualAvoid: next.manualAvoid })
              }}
            />
            <Switch
              checked={row.manualAvoid}
              label="避雷"
              onCheckedChange={(v) => {
                const next = applyAvoidChange(
                  { rating: row.rating, manualAvoid: row.manualAvoid },
                  v,
                )
                onPatch(row.id, { manualAvoid: next.manualAvoid })
              }}
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={row.price ?? ''}
              placeholder="价格（可选）"
              className="w-32"
              onChange={(e) =>
                onPatch(row.id, { price: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            <Input
              value={row.scene}
              placeholder="场景：聚餐 / 一人食…"
              className="flex-1"
              onChange={(e) => onPatch(row.id, { scene: e.target.value })}
            />
          </div>
          <Textarea
            value={row.comment}
            placeholder="感想（可选，AI 会据此提取口味标签）"
            rows={2}
            onChange={(e) => onPatch(row.id, { comment: e.target.value })}
          />
          <p className="flex items-center gap-1 text-xs text-ink-muted">
            <Sparkles className="h-3 w-3" aria-hidden />
            保存后 AI 将异步提取口味标签
          </p>
        </div>
      )}
    </li>
  )
}
