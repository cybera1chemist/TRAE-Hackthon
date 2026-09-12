import { useParams } from 'react-router-dom'
import { PagePlaceholder } from './PagePlaceholder'

/** 占位店铺详情页：真实页面由 Agent-5 交付 T1-11 */
export function Component() {
  const { rid } = useParams()
  return (
    <PagePlaceholder
      title="店铺详情"
      owner="Agent-5 · dex"
      hint={rid ? `店铺 ID：${rid}。将包含进度条、分区网格与避雷横幅。` : undefined}
    />
  )
}
