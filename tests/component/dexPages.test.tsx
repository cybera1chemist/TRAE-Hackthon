/**
 * Agent-5 页面集成测试（T1-10/T1-11/T3-07/T4-03）：
 * 强制内存数据层 + 真实 Repositories + TanStack Query，覆盖
 * 图鉴三态/筛选/搜索、店铺进度五档/避雷横幅、菜品时间线/删 Log 回退联动。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/ui'
import { Component as DexPage } from '@/pages/dex/DexPage'
import { Component as RestaurantPage } from '@/pages/restaurant/RestaurantPage'
import { Component as DishPage } from '@/pages/dish/DishPage'
import { Component as InsightsPage } from '@/pages/insights/InsightsPage'
import { initDataLayerForTest, resetDataLayerForTest } from '@/application/data/dataLayer'
import { useAvoidDishWarning } from '@/application/data/queries'
import type { DataLayer } from '@/infra/db'

// jsdom 无 ResizeObserver / 布局尺寸：打桩让虚拟网格按 360px 宽渲染
beforeAll(() => {
  class ResizeObserverStub {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element): void {
      queueMicrotask(() =>
        this.cb(
          [{ target, contentRect: { width: 360, height: 600 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        ),
      )
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 360,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
})

let layer: DataLayer
let ids: { r1: string; r2: string; d1: string; d2: string; d3: string; d4: string }

async function seed(): Promise<void> {
  resetDataLayerForTest()
  layer = await initDataLayerForTest({ force: 'memory', requestPersistence: false })
  const r1 = await layer.repos.restaurants.create({
    name: '川香小馆',
    city: '深圳',
    district: '南山区',
  })
  const r2 = await layer.repos.restaurants.create({ name: '樱寿司', city: '深圳' })
  const d1 = await layer.repos.dishes.create(r1.id, {
    name: '麻婆豆腐',
    nameSource: 'user',
    section: '热菜',
  })
  const d2 = await layer.repos.dishes.create(r1.id, {
    name: '白切鸡',
    nameSource: 'user',
    section: '热菜',
  })
  const d3 = await layer.repos.dishes.create(r1.id, {
    name: '凉拌木耳',
    nameSource: 'ocr',
    section: '凉菜',
  })
  const d4 = await layer.repos.dishes.create(r2.id, {
    name: '三文鱼刺身',
    nameSource: 'user',
    section: '刺身',
  })
  await layer.repos.logs.addMany([
    {
      dishId: d1.id,
      restaurantId: r1.id,
      rating: 1.5,
      manualAvoid: false,
      comment: '太咸了',
      ateAt: daysAgo(2),
    },
    {
      dishId: d2.id,
      restaurantId: r1.id,
      rating: 4.5,
      manualAvoid: false,
      comment: '鸡味十足',
      ateAt: daysAgo(5),
    },
    {
      dishId: d2.id,
      restaurantId: r1.id,
      rating: 4.0,
      manualAvoid: false,
      comment: '',
      ateAt: daysAgo(20),
    },
    {
      dishId: d4.id,
      restaurantId: r2.id,
      rating: 5,
      manualAvoid: false,
      comment: '入口即化',
      ateAt: daysAgo(1),
    },
  ])
  await layer.repos.dishes.update(d2.id, {
    tags: [
      { dim: 'taste', value: '清淡', source: 'user' },
      { dim: 'cuisine', value: '粤菜', source: 'ai' },
    ],
  })
  await layer.repos.dishes.update(d4.id, {
    tags: [
      { dim: 'taste', value: '清淡', source: 'ai' },
      { dim: 'cuisine', value: '日料', source: 'ai' },
    ],
  })
  ids = { r1: r1.id, r2: r2.id, d1: d1.id, d2: d2.id, d3: d3.id, d4: d4.id }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function LocationProbe() {
  const location = useLocation()
  return (
    <span data-testid="loc" hidden>
      {location.search}
    </span>
  )
}

function renderRoute(path: string, ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/" element={ui} />
            <Route path="/restaurant/:rid" element={<RestaurantPage />} />
            <Route path="/dish/:id" element={<DishPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Agent-5 页面集成（内存数据层）', () => {
  beforeEach(async () => {
    await seed()
  })

  afterAll(() => {
    resetDataLayerForTest()
  })

  it('T1-10 图鉴页：统计条、三态格子、筛选与 URL 联动', async () => {
    renderRoute('/', <DexPage />)

    await waitFor(() => expect(screen.getByText('美食图鉴')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/共 4 道/)).toBeInTheDocument())

    const header = within(screen.getByRole('banner'))
    expect(header.getByText(/已解锁/).textContent).toContain('3')
    expect(header.getByText(/避雷/).textContent).toContain('1')

    // 菜名全部可见（灰菜也显示名字）
    expect(screen.getAllByText('麻婆豆腐').length).toBeGreaterThan(0)
    expect(screen.getByText('凉拌木耳')).toBeInTheDocument()

    // 避雷红色角标（格子 + 筛选 chips 多处出现）
    expect(screen.getAllByText('避雷').length).toBeGreaterThan(1)

    // 未解锁筛选：只剩灰菜
    fireEvent.click(screen.getByRole('button', { name: '未解锁' }))
    await waitFor(() => expect(screen.getByText(/共 1 道/)).toBeInTheDocument())
    expect(screen.getByText('凉拌木耳')).toBeInTheDocument()
    expect(screen.queryByText('麻婆豆腐')).not.toBeInTheDocument()

    // URL 已同步（可分享/刷新）
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('f=locked'))

    // 避雷筛选
    fireEvent.click(screen.getByRole('button', { name: '避雷' }))
    await waitFor(() => expect(screen.getByText(/共 1 道/)).toBeInTheDocument())
    expect(screen.getByText('麻婆豆腐')).toBeInTheDocument()
  })

  it('T1-10 菜系视图分组 + T4-06 全局搜索角标', async () => {
    renderRoute('/', <DexPage />)
    await waitFor(() => expect(screen.getByText(/共 4 道/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '按菜系' }))
    const yueChip = await screen.findByRole('button', { name: /粤菜/ })
    fireEvent.click(yueChip)
    await waitFor(() => expect(screen.getByText(/共 1 道/)).toBeInTheDocument())
    expect(screen.getByText('白切鸡')).toBeInTheDocument()

    // 搜索：避雷菜品结果带角标且不折叠
    fireEvent.click(screen.getByRole('button', { name: '按店铺' }))
    const input = screen.getByLabelText('全局搜索')
    fireEvent.change(input, { target: { value: '麻婆' } })
    const dishHeading = await screen.findByRole('heading', { name: '菜品' })
    expect(dishHeading).toBeInTheDocument()
    expect(screen.getByText('麻婆豆腐')).toBeInTheDocument()
    expect(screen.getAllByText('避雷').length).toBeGreaterThan(0)
  })

  it('T1-11/T3-07 店铺详情：进度五档、避雷横幅、分区、空态不出现', async () => {
    renderRoute(`/restaurant/${ids.r1}`, <RestaurantPage />)

    await waitFor(() => expect(screen.getAllByText('川香小馆').length).toBeGreaterThan(0))
    // 3 道菜解锁 2 道（67%）→ 老饕
    expect(screen.getByText('老饕')).toBeInTheDocument()
    expect(screen.getByText(/制霸进度 2\/3/)).toBeInTheDocument()
    // 避雷黄色横幅
    expect(screen.getByText(/道避雷菜/).textContent).toContain('1')
    // 分区
    expect(screen.getByText('热菜')).toBeInTheDocument()
    expect(screen.getByText('凉菜')).toBeInTheDocument()
    // 有菜单，空态不出现
    expect(screen.queryByText('还没有菜单')).not.toBeInTheDocument()
  })

  it('T1-11 菜品详情：时间线展示，删除最后一条 Log 联动回退未解锁（EC-DEX-03）', async () => {
    renderRoute(`/dish/${ids.d1}`, <DishPage />)

    await waitFor(() => expect(screen.getAllByText('麻婆豆腐').length).toBeGreaterThan(0))
    expect(screen.getAllByText('避雷').length).toBeGreaterThan(0)
    expect(screen.getByText('太咸了')).toBeInTheDocument()
    expect(screen.getByText('追加打卡')).toBeInTheDocument()

    // 删除打卡 → 确认弹窗 → 确认
    fireEvent.click(screen.getByRole('button', { name: '删除该打卡' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(screen.getByText(/回退为未解锁/)).toBeInTheDocument())
  })

  it('T4-03 菜品页撤销避雷即时生效', async () => {
    renderRoute(`/dish/${ids.d1}`, <DishPage />)
    await waitFor(() => expect(screen.getAllByText('麻婆豆腐').length).toBeGreaterThan(0))

    const sw = screen.getByRole('switch', { name: /避雷/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByText('已撤销避雷')).toBeInTheDocument()
  })

  it('T4-03 打卡前避雷提醒 hook：fuzzy 命中/未命中/店铺限定', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    type HookProps = { name: string; rid?: string }
    const { result, rerender } = renderHook<ReturnType<typeof useAvoidDishWarning>, HookProps>(
      ({ name, rid }) => useAvoidDishWarning(name, rid),
      { wrapper, initialProps: { name: '麻婆' } },
    )
    await waitFor(() => expect(result.current.matches).toHaveLength(1))
    expect(result.current.matches[0].dish.id).toBe(ids.d1)
    expect(result.current.matches[0].restaurantName).toBe('川香小馆')

    rerender({ name: '白切鸡' })
    await waitFor(() => expect(result.current.matches).toHaveLength(0))

    rerender({ name: '麻婆豆腐', rid: ids.r2 })
    await waitFor(() => expect(result.current.matches).toHaveLength(0))

    rerender({ name: '麻婆豆腐', rid: ids.r1 })
    await waitFor(() => expect(result.current.matches).toHaveLength(1))
  })

  it('T4-02 打卡不足 5 次：总览卡显示真实 0，图表位给解锁提示而非示例数据（EC-INS-01）', async () => {
    resetDataLayerForTest()
    await initDataLayerForTest({ force: 'memory', requestPersistence: false })
    renderRoute('/', <InsightsPage />)

    // 总览四张卡都是真实的 0（示例数据的 9/8/2/3 不允许出现）
    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(4))
    expect(screen.queryByText('9')).not.toBeInTheDocument()
    expect(screen.queryByText('8')).not.toBeInTheDocument()

    // 口味画像、菜系分布两处均为解锁提示，不渲染图表
    const hints = screen.getAllByText('再打卡 5 次即可解锁')
    expect(hints).toHaveLength(2)
    expect(screen.queryByText('标签云')).not.toBeInTheDocument()
    expect(screen.queryByText('环形图')).not.toBeInTheDocument()

    // 避雷库未解锁不渲染；底部旧的「专属洞察未解锁」整块已移除
    expect(screen.queryByText('避雷库')).not.toBeInTheDocument()
    expect(screen.queryByText('专属洞察未解锁')).not.toBeInTheDocument()
  })
})
