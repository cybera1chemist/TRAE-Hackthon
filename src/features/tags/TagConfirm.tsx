import { useMemo, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { Button, Chip, Input, cn } from '@/ui'
import { addCustomTag, applyTagConfirm, bandTags } from './confirm'
import type { Tag } from '@/domain/entities'

export interface TagConfirmProps {
  dishName: string
  tags: Tag[]
  /** 确认提交（合并后的最终标签集） */
  onConfirm: (tags: Tag[]) => void
  /** 跳过（保留现状，猜测区保持未确认） */
  onSkip?: () => void
  className?: string
}

/**
 * 标签确认 UI（T2-06）：Chips 勾选、<0.6 进「AI 还猜了」、自定义标签增删。
 * 用法：打卡结果页 / 菜品详情等拿到 Dish.tags 后传入。
 */
export function TagConfirm({ dishName, tags, onConfirm, onSkip, className }: TagConfirmProps) {
  const bands = useMemo(() => bandTags(tags), [tags])
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(bands.confirmed.map((t) => t.key)),
  )
  const [draft, setDraft] = useState('')
  const [working, setWorking] = useState<Tag[]>([])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const addDraft = () => {
    setWorking((prev) => addCustomTag(prev, draft))
    setDraft('')
  }

  const submit = () => {
    onConfirm(applyTagConfirm(tags, selected, working))
  }

  return (
    <div className={cn('space-y-4', className)}>
      {bands.confirmed.length > 0 && (
        <section>
          <p className="mb-2 flex items-center gap-1 text-sm font-medium text-ink">
            <Sparkles className="h-4 w-4 text-gold" aria-hidden />
            已识别标签 · {dishName}
          </p>
          <div className="flex flex-wrap gap-2">
            {bands.confirmed.map((t) => (
              <Chip
                key={t.key}
                tone={t.source === 'user' ? 'default' : 'ai'}
                selected={selected.has(t.key)}
                onClick={t.locked ? undefined : () => toggle(t.key)}
                ariaLabel={t.locked ? `我的标签 ${t.value}` : `AI 建议 ${t.value}`}
              >
                {t.value}
                {t.source === 'ai' && t.confidence !== undefined && (
                  <span className="text-xs opacity-60">{Math.round(t.confidence * 100)}%</span>
                )}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {bands.guesses.length > 0 && (
        <section>
          <p className="mb-2 text-sm text-ink-muted">AI 还猜了（点选采纳，不选将忽略）</p>
          <div className="flex flex-wrap gap-2">
            {bands.guesses.map((t) => (
              <Chip
                key={t.key}
                tone="ai"
                selected={selected.has(t.key)}
                onClick={() => toggle(t.key)}
                ariaLabel={`AI 猜测 ${t.value} ${Math.round((t.confidence ?? 0) * 100)}%`}
              >
                {t.value}
                <span className="text-xs opacity-60">{Math.round((t.confidence ?? 0) * 100)}%</span>
              </Chip>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="mb-2 text-sm text-ink-muted">自定义标签</p>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="如：深夜食堂、一人食"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addDraft()
              }
            }}
            className="flex-1"
          />
          <Button variant="secondary" onClick={addDraft} disabled={!draft.trim()}>
            <Plus className="h-4 w-4" aria-hidden />
            添加
          </Button>
        </div>
        {working.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {working.map((t) => (
              <Chip
                key={`${t.dim}:${t.value}`}
                tone="gold"
                onRemove={() => setWorking((prev) => prev.filter((x) => x !== t))}
              >
                {t.value}
              </Chip>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            稍后再说
          </Button>
        )}
        <Button variant="primary" onClick={submit}>
          确认标签
        </Button>
      </div>
    </div>
  )
}
