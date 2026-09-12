import { expect, test } from '@playwright/test'

/**
 * E2E-AI-FALLBACK —— PRD §10.1 #2：AI 失败/超时场景全部手动降级路径可用且草稿不丢。
 * 前置依赖：Agent-2 Mock adapter 失败注入开关（VITE_AI_MODE=mock + fail 标记）。
 */
test.fixme('识别超时 → 15s 降级手动输入，草稿保留', async ({ page }) => {
  await page.goto('/capture')

  // 1. mock 注入 recognize 超时 → 等待 15s 超时降级提示
  // 2. 手动填菜名/星级/避雷 → 保存成功（PRD §6 全部手动降级路径）
  // 3. 刷新后草稿仍在（24h 草稿机制）
  await expect(page.getByText('保存成功')).toBeVisible()
})

test.fixme('断网/脏 JSON/低置信 均归一为可降级错误', async () => {
  // mock 失败模式切换：断网、HTTP 500、脏 JSON 三分支
  // 断言：错误 toast 文案可理解 +「手动填写」入口可直达
  expect(true).toBe(true)
})
