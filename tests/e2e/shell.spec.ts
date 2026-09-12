import { expect, test } from '@playwright/test'

/**
 * App Shell 冒烟（T0-07 验收：四个空页面可切换）。
 * 双视口（mobile 360×800 / desktop 1280×720）由 playwright.config.ts projects 提供。
 */
test.describe('App Shell', () => {
  test('底部导航 4 Tab 可切换', async ({ page }) => {
    await page.goto('/')

    // 首页
    await expect(page.getByRole('heading', { name: '首页' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: '主导航' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link')).toHaveCount(4)

    // 图鉴
    await nav.getByRole('link', { name: '图鉴' }).click()
    await expect(page.getByRole('heading', { name: '美食图鉴' })).toBeVisible()

    // 洞察
    await nav.getByRole('link', { name: '洞察' }).click()
    await expect(page.getByRole('heading', { name: '洞察', exact: true })).toBeVisible()

    // 我的
    await nav.getByRole('link', { name: '我的' }).click()
    await expect(page.getByRole('heading', { name: '我的', exact: true })).toBeVisible()

    // 回首页（NavLink end 精确匹配）
    await nav.getByRole('link', { name: '首页' }).click()
    await expect(page.getByRole('heading', { name: '首页' })).toBeVisible()
  })

  test('全屏占位路由可直达（capture / scan）', async ({ page }) => {
    await page.goto('/capture')
    await expect(page.getByRole('heading', { name: '极速打卡' })).toBeVisible()

    await page.goto('/scan/rst_demo')
    await expect(page.getByRole('heading', { name: '扫描菜单' })).toBeVisible()
  })
})
