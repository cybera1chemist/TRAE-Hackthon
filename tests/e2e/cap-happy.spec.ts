import { expect, test } from '@playwright/test'

/**
 * E2E-CAP-HAPPY —— PRD §10.1 #1：拍照到保存一条打卡（高置信单菜品）3 次点击内完成。
 * 前置依赖：Agent-3 `/capture` 流程页 + Agent-2 Mock adapter（recognize 夹具高置信）。
 * 依托：mock 模式夹具固定，断言可确定性编写。
 */
test.fixme('高置信单菜品 3 次点击完成打卡（移动端视口）', async ({ page }) => {
  await page.goto('/capture')

  // 1. 拍照/选图：注入测试图片（mock 夹具对应 菜品图）→ 点击识别
  // 2. 识别确认页：高置信（≥0.8）单菜品默认勾选 → 点击保存
  // 3. 附加信息可选跳过 → 断言保存成功动效 + 跳转
  await expect(page.getByText('保存成功')).toBeVisible()

  // 断言：时间线出现新 Log；图鉴对应菜解锁（彩色态）
})
