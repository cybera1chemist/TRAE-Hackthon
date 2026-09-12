import { expect, test } from '@playwright/test'

/**
 * E2E-AVOID-LINKS —— PRD §10.1 #4：避雷联动三处全部生效并可撤销。
 * 前置依赖：Agent-3 打卡前提示 hook、Agent-5 横幅/搜索角标、Agent-1 avoid.evaluate。
 */
test.fixme('避雷三处联动：店铺横幅 / 相似菜打卡前提示 / 全局搜索角标', async () => {
  // 1. 打卡 1 星 → 菜品标记避雷
  // 2. 店铺详情：顶部避雷横幅 + 该菜置顶高亮
  // 3. 打卡本店另一菜（与避雷菜相似度 ≥0.8）→ 保存前弹提示（Agent-4 hook）
  // 4. 全局搜索该菜 → 结果带避雷角标
  // 5. 洞察页避雷库 → 撤销避雷 → 三处联动全部恢复
  expect(true).toBe(true)
})
