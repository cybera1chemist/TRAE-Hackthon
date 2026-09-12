import { useParams } from 'react-router-dom'
import { PagePlaceholder } from './PagePlaceholder'

/** 占位菜品详情页：真实页面由 Agent-5 交付 T1-11 */
export function Component() {
  const { id } = useParams()
  return (
    <PagePlaceholder
      title="菜品详情"
      owner="Agent-5 · dex"
      hint={id ? `菜品 ID：${id}。将包含画廊、评分、标签与 Log 时间线。` : undefined}
    />
  )
}
