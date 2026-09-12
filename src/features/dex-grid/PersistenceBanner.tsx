import { AlertTriangle } from 'lucide-react'
import { useDataLayer } from '@/application/data/queries'

/** IDB 不可用降级内存模式时的强提示（TDD §7.2：UI 须提示无法持久化） */
export function PersistenceBanner() {
  const { layer } = useDataLayer()
  if (!layer || layer.mode !== 'memory') return null
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-card border border-gold/50 bg-gold/10 px-3 py-2 text-xs text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
      <span>
        当前环境无法使用本地持久化存储，数据仅保存在内存中，关闭页面即丢失。 请尽快到「设置 →
        备份与恢复」导出备份。
      </span>
    </div>
  )
}
