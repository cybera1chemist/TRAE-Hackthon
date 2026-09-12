import { PagePlaceholder } from './PagePlaceholder'

/** 占位菜单扫描页（全屏流程）：真实页面由 Agent-4（scan）交付 T3-01~08 */
export function Component() {
  return (
    <PagePlaceholder title="扫描菜单" owner="Agent-4 · scan" hint="上传 → OCR → 确认 → 关联。" />
  )
}
