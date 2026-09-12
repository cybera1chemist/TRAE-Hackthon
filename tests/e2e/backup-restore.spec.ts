import { expect, test } from '@playwright/test'

/**
 * E2E-BACKUP-RESTORE —— PRD §10.1 #7：数据导出 JSON 清空浏览器后完整导入恢复（图片随包场景）。
 * 前置依赖：Agent-1 备份导出/导入（T5-05，schemaVersion 校验、分卷）。
 */
test.fixme('导出 → 清空 IDB → 导入恢复（含图片与图鉴状态）', async ({ page }) => {
  await page.goto('/settings')

  // 1. 造数据：1 店 2 菜 1 打卡（带图、1 条避雷）→ 导出 JSON（图片 base64 分卷）
  // 2. 清空存储（设置页「清空数据」或 CDP clear）
  // 3. 导入该 JSON → 预览冲突确认（matchDish 同构）→ 提交
  // 4. 断言：店铺/菜品/Log/图片 Blob/解锁与避雷状态完全恢复；高版本 schema 拒绝导入
  expect(true).toBe(true)
})
