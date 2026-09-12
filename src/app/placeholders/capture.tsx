import { PagePlaceholder } from './PagePlaceholder'

/** 占位极速打卡页（全屏流程，无底部导航）：真实页面由 Agent-3 交付 T1-08/T2-03 */
export function Component() {
  return (
    <PagePlaceholder title="极速打卡" owner="Agent-3 · capture" hint="拍照 → 识别 → 确认保存。" />
  )
}
