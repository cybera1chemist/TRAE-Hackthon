import { Construction } from 'lucide-react'
import { Empty } from '@/ui'

export interface PagePlaceholderProps {
  title: string
  /** 负责交付该页面的 Agent（分工文档 §2 目录所有权） */
  owner: string
  hint?: string
}

/**
 * 路由占位页（T0-07）：pages/ 目录所有权归各业务 Agent，故占位组件统一放在 src/app/，
 * 各 Agent 交付真实页面后，由 Agent-0 在 router.tsx 替换对应 lazy() 片段（分工 §2.4）。
 */
export function PagePlaceholder({ title, owner, hint }: PagePlaceholderProps) {
  return (
    <section aria-labelledby="page-title" className="mx-auto w-full max-w-2xl px-4 pt-6">
      <h1 id="page-title" className="mb-2 font-display text-xl font-semibold text-ink">
        {title}
      </h1>
      <Empty
        icon={<Construction className="h-7 w-7" aria-hidden />}
        title="施工中"
        description={`此页面由 ${owner} 交付。${hint ?? ''}`}
      />
    </section>
  )
}
