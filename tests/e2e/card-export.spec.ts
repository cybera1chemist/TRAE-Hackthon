import { expect, test } from '@playwright/test'

/**
 * E2E-CARD-EXPORT —— PRD §10.1 #6：三套模板海报导出 PNG 无白屏、无跨域污染、无字体回退。
 * Agent-6 自有链路；引擎纯逻辑已被 tests/unit/cardEngine.test.ts 覆盖。
 * 依托：EC-CARD-01 无图占位 / EC-CARD-02 缺字段重排 / EC-CARD-04 污染探测 / EC-CARD-05 字体就绪。
 */
test.fixme('三模板 × 有图/无图/避雷 导出 1080×1440 PNG', async ({ page }) => {
  await page.goto('/card') // 出片页路由由 Agent-0 路由表合并（T5-04）

  // 1. 打卡成功页入口 → 出片页；模板横滑切换 A/B/C
  // 2. 无图数据 → 菜系色占位；缺店名/标签 → 版式重排无空块
  // 3. 1 星数据 → 雷品警报黄黑皮肤
  // 4. 点击保存 → downloads 事件拿到 PNG；断言尺寸 1080×1440、无全白像素
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存' }).click()
  expect((await download).suggestedFilename()).toMatch(/^fooddex_.+_\d{8}\.png$/)
})

test.fixme('Web Share 降级：不支持分享时显示长按保存提示', async () => {
  // 桌面 Chromium 无 navigator.share files 支持 → 断言「长按图片保存」提示出现
  expect(true).toBe(true)
})
