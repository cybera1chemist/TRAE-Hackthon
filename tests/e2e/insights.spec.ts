import { expect, test } from '@playwright/test'

/**
 * E2E-INSIGHTS —— PRD §10.1 #5：味蕾云图、菜系占比统计口径与 §5.4.1 一致，小数据量有空态。
 * 前置依赖：Agent-5 洞察页 + stats.worker + statCache。
 */
test.fixme('洞察页统计口径与空态', async ({ page }) => {
  await page.goto('/insights')

  // 1. 空库 → 各卡片空态（CTA 引导打卡，无 NaN/空白图表）
  // 2. 造 3 条 Log（近 365 天内 + 1 条跨年外）→ 断言分母只计近 365 天
  // 3. 断言 cuisine.primary 单选归一、维度内占比和为 100%、streak 连续天数
  expect(true).toBe(true)
})
