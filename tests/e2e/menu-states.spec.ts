import { expect, test } from '@playwright/test'

/**
 * E2E-MENU-STATES —— PRD §10.1 #3：菜单扫描 → 二次确认 → 未解锁/已解锁/避雷三态在店铺页正确呈现。
 * 前置依赖：Agent-4 `/scan` 状态机 + Agent-1 matchDish（阈值 0.8/0.95）。
 */
test.fixme('扫描两轮同店：第二轮仅确认差异（增量 diff）', async ({ page }) => {
  await page.goto('/scan/rst_demo')

  // 1. 上传 mock 菜单夹具图 → OCR 确认页：改菜名/价/分区 → 保存
  // 2. 二次扫描（加一道菜、删一道菜）→ 仅新增/删除项需确认
  // 3. 断言：精确匹配不产生重复菜；nameSource=user 不被覆盖
  await expect(page.getByText('已确认')).toBeVisible()
})

test.fixme('店铺页三态呈现：未解锁灰问号 / 已解锁彩色 / 避雷红角标', async ({ page }) => {
  await page.goto('/restaurant/rst_demo')

  // 断言 Agent-5 店铺详情：分区网格三态、进度条与五档等级文案
  expect(true).toBe(true)
})
