import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ImageDown, Loader2, PartyPopper, Repeat2 } from 'lucide-react'
import { Button, useToast } from '@/ui'
import { emitDataChanged } from '@/application/data/dataBus'
import { TagConfirm } from '@/features/tags/TagConfirm'
import type { Tag } from '@/domain/entities'
import type { SaveResult } from '@/features/capture/createLogWorkflow'

export interface DoneStepProps {
  result: SaveResult
  repos: {
    logs: {
      get(
        id: string,
      ): Promise<{ id: string; dishId: string; tagExtractionState: string } | undefined>
    }
    dishes: {
      get(id: string): Promise<{ id: string; name: string; tags: Tag[] } | undefined>
      update(id: string, patch: { tags: Tag[] }): Promise<void>
    }
  }
  onContinue: () => void
}

interface TagView {
  state: 'pending' | 'done' | 'failed'
  dishId?: string
  dishName?: string
  tags?: Tag[]
}

/** 解锁动效 keyframes（页面局部，不污染全局样式） */
function UnlockKeyframes() {
  return (
    <style>{`
      @keyframes fdx-unlock-pop {
        0% { transform: scale(0.85); opacity: 0; }
        60% { transform: scale(1.04); }
        100% { transform: scale(1); opacity: 1; }
      }
      @keyframes fdx-unlock-glow {
        0%, 100% { box-shadow: 0 0 0 0 rgb(var(--c-gold) / 0); }
        50% { box-shadow: 0 0 24px 4px rgb(var(--c-gold) / 0.45); }
      }
    `}</style>
  )
}

/**
 * 打卡结果页（T2-08 / T2-06）：解锁动效（NEW 卡片）+ 追加态（第 N 次打卡）+
 * 标签回填状态跟踪（AsyncQueue 完成 → 内联确认 UI，<0.6 进「AI 还猜了」）。
 * 出片入口预留挂载点（Agent-6 渲染器就绪后接入）。
 */
export function DoneStep({ result, repos, onContinue }: DoneStepProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const [tagViews, setTagViews] = useState<Record<string, TagView>>({})
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const aliveRef = useRef(true)

  const allLogs = result.logs

  useEffect(() => {
    aliveRef.current = true
    const poll = async () => {
      const entries = await Promise.all(
        allLogs.map(async (log): Promise<[string, TagView]> => {
          const l = await repos.logs.get(log.id)
          if (!l) return [log.id, { state: 'done' }]
          if (l.tagExtractionState === 'failed') return [log.id, { state: 'failed' }]
          if (l.tagExtractionState !== 'done') return [log.id, { state: 'pending' }]
          const dish = await repos.dishes.get(l.dishId)
          return [
            log.id,
            { state: 'done', dishId: l.dishId, dishName: dish?.name, tags: dish?.tags ?? [] },
          ]
        }),
      )
      if (aliveRef.current) setTagViews(Object.fromEntries(entries))
    }
    void poll()
    const timer = setInterval(poll, 1_500)
    return () => {
      aliveRef.current = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const confirmTags = async (logId: string, dishId: string, tags: Tag[]) => {
    await repos.dishes.update(dishId, { tags })
    emitDataChanged('dish')
    setConfirmed((prev) => new Set(prev).add(logId))
    toast({ title: '标签已保存', variant: 'success' })
  }

  const target = result.unlocked[0] ?? result.appended[0]

  return (
    <>
      <UnlockKeyframes />
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4 pb-10">
        <header className="flex flex-col items-center gap-1 pt-6 text-center">
          <PartyPopper className="h-8 w-8 text-gold" aria-hidden />
          <h1 className="text-xl font-semibold text-ink">打卡成功！</h1>
          <p className="text-sm text-ink-muted">{result.restaurant.name}</p>
        </header>

        {result.unlocked.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-ink">
              新解锁 {result.unlocked.length} 道菜
            </h2>
            <ul className="space-y-2">
              {result.unlocked.map((d, i) => (
                <li
                  key={d.id}
                  className="rounded-card border border-gold/50 bg-gold/5 p-4"
                  style={{
                    animation: `fdx-unlock-pop 0.5s ease-out ${i * 0.12}s both, fdx-unlock-glow 1.6s ease-in-out ${i * 0.12}s 2`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-medium text-ink">{d.name}</span>
                    <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-primary-fg">
                      NEW 图鉴 +1
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result.appended.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-ink">追加打卡</h2>
            <ul className="space-y-2">
              {result.appended.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-card border border-line bg-surface p-3"
                >
                  <span className="text-ink">{d.name}</span>
                  <span className="flex items-center gap-1 text-xs text-ink-muted">
                    <Repeat2 className="h-3.5 w-3.5" aria-hidden />第 {d.stats.logCount} 次打卡
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 标签回填 + 确认（T2-06） */}
        {allLogs.map((log) => {
          const view = tagViews[log.id]
          if (!view) return null
          if (view.state === 'pending') {
            return (
              <p key={log.id} className="flex items-center gap-2 text-sm text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                AI 正在从图片与感想提取标签…
              </p>
            )
          }
          if (view.state === 'failed' || !view.tags) {
            return (
              <p key={log.id} className="text-sm text-ink-muted">
                标签提取暂失败，可稍后在菜品详情重试
              </p>
            )
          }
          if (confirmed.has(log.id) || view.tags.length === 0) {
            return (
              <p key={log.id} className="flex items-center gap-1 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                标签已就绪
              </p>
            )
          }
          return (
            <section key={log.id} className="rounded-card border border-line bg-surface p-4">
              <TagConfirm
                dishName={view.dishName ?? ''}
                tags={view.tags}
                onConfirm={(tags) => void confirmTags(log.id, view.dishId ?? '', tags)}
                onSkip={() => setConfirmed((prev) => new Set(prev).add(log.id))}
              />
            </section>
          )
        })}

        <div className="mt-2 flex flex-col gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              // 出片功能挂载点：Agent-6 渲染器交付后接入（卡片数据 = 本次打卡）
              toast({ title: '出片功能即将上线', description: '成就卡渲染器联调中' })
            }}
          >
            <ImageDown className="h-4 w-4" aria-hidden />
            生成成就卡
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onContinue}>
              继续打卡
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => navigate(target ? `/dish/${target.id}` : '/dex')}
            >
              返回图鉴
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
