/**
 * 数据查询 hooks（应用组合层，TanStack Query v5）。
 * Agent-5 的图鉴/店铺/菜品/洞察页面统一经此读取 Agent-1 仓储；
 * 写操作走 mutations，成功后失效相关查询并广播 dataBus（stats SWR 联动）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { Dish, Log, Photo, Restaurant } from '@/domain/entities'
import type { DataLayer } from '@/infra/db'
import { subscribeDataChanged, emitDataChanged, type DataChangeScope } from './dataBus'
import { getDataLayer } from './dataLayer'
import { listRestaurants } from './listRestaurants'

export const queryKeys = {
  restaurants: () => ['restaurants'] as const,
  restaurant: (id: string) => ['restaurants', id] as const,
  dishes: () => ['dishes'] as const,
  dish: (id: string) => ['dishes', id] as const,
  logs: () => ['logs'] as const,
  logsByDish: (dishId: string) => ['logs', 'by-dish', dishId] as const,
  photo: (id: string) => ['photos', id] as const,
}

/** 数据层初始化状态（页面据此渲染加载/降级提示） */
export function useDataLayer(): {
  layer: DataLayer | null
  loading: boolean
  error: Error | null
} {
  const [state, setState] = useState<{
    layer: DataLayer | null
    loading: boolean
    error: Error | null
  }>({ layer: null, loading: true, error: null })

  useEffect(() => {
    let alive = true
    getDataLayer().then(
      (layer) => alive && setState({ layer, loading: false, error: null }),
      (err) =>
        alive &&
        setState({
          layer: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        }),
    )
    return () => {
      alive = false
    }
  }, [])

  return state
}

/**
 * 把 dataBus 的变更广播桥接到 TanStack Query 失效。
 * Agent-3 打卡流等外部写事务成功后只需 emitDataChanged，本页查询即自动刷新。
 * 在 Agent-5 各页面根部挂载一次。
 */
export function useDataBridge(): void {
  const qc = useQueryClient()
  useEffect(() => {
    return subscribeDataChanged((scope: DataChangeScope) => {
      if (scope === 'all') {
        void qc.invalidateQueries()
        return
      }
      if (scope === 'restaurant' || scope === 'dish' || scope === 'log' || scope === 'photo') {
        void qc.invalidateQueries({ queryKey: ['restaurants'] })
        void qc.invalidateQueries({ queryKey: ['dishes'] })
        void qc.invalidateQueries({ queryKey: ['logs'] })
        void qc.invalidateQueries({ queryKey: ['photos'] })
      }
    })
  }, [qc])
}

export function useRestaurants() {
  const { layer, loading } = useDataLayer()
  const query = useQuery({
    queryKey: queryKeys.restaurants(),
    enabled: !!layer,
    queryFn: () => listRestaurants(layer!),
    staleTime: 30_000,
  })
  return { ...query, layerLoading: loading }
}

export function useRestaurant(id: string | undefined) {
  const { layer } = useDataLayer()
  return useQuery({
    queryKey: queryKeys.restaurant(id ?? ''),
    enabled: !!layer && !!id,
    queryFn: () => layer!.repos.restaurants.get(id!),
    staleTime: 30_000,
  })
}

export function useAllDishes() {
  const { layer } = useDataLayer()
  return useQuery({
    queryKey: queryKeys.dishes(),
    enabled: !!layer,
    queryFn: () => layer!.repos.dishes.listByFilter({}),
    staleTime: 30_000,
  })
}

export function useDish(id: string | undefined) {
  const { layer } = useDataLayer()
  return useQuery({
    queryKey: queryKeys.dish(id ?? ''),
    enabled: !!layer && !!id,
    queryFn: () => layer!.repos.dishes.get(id!),
    staleTime: 15_000,
  })
}

export function useDishLogs(dishId: string | undefined) {
  const { layer } = useDataLayer()
  return useQuery<Log[]>({
    queryKey: queryKeys.logsByDish(dishId ?? ''),
    enabled: !!layer && !!dishId,
    queryFn: () => layer!.repos.logs.listByDish(dishId!),
    staleTime: 15_000,
  })
}

export function useAllLogs() {
  const { layer } = useDataLayer()
  return useQuery<Log[]>({
    queryKey: queryKeys.logs(),
    enabled: !!layer,
    queryFn: () => layer!.repos.logs.listAll(100_000),
    staleTime: 30_000,
  })
}

/** 取单张照片元数据（object URL 由 useBlobUrl 解析） */
export function usePhoto(photoId: string | null | undefined) {
  const { layer } = useDataLayer()
  return useQuery<Photo | undefined>({
    queryKey: queryKeys.photo(photoId ?? ''),
    enabled: !!layer && !!photoId,
    queryFn: () => layer!.repos.photos.get(photoId!),
    staleTime: 5 * 60_000,
  })
}

// ── 避雷联动（T4-03 三处联动之③：打卡前 fuzzy 提示，供 Agent-3/4 打卡流消费） ─────

export interface AvoidDishWarning {
  dish: Dish
  restaurantName: string | null
}

/**
 * 输入菜名时本地模糊匹配已有避雷菜品：
 * 归一化后等值或互相包含（长度 ≥2 才启用包含匹配，避免单字误报）。
 * 传 restaurantId 时仅匹配同店；未命中/名称为空返回空数组。
 */
export function useAvoidDishWarning(
  rawName: string,
  restaurantId?: string,
): { matches: AvoidDishWarning[]; loading: boolean } {
  const dishesQuery = useAllDishes()
  const restsQuery = useRestaurants()
  const name = rawName.trim().toLowerCase()

  const matches = useMemo<AvoidDishWarning[]>(() => {
    if (!name || !dishesQuery.data) return []
    const hit = (target: string) => {
      const t = target.trim().toLowerCase()
      if (!t) return false
      return (
        t === name || (name.length >= 2 && t.length >= 2 && (t.includes(name) || name.includes(t)))
      )
    }
    const restMap = new Map((restsQuery.data ?? []).map((r) => [r.id, r.name]))
    return dishesQuery.data
      .filter((d) => d.isAvoid)
      .filter((d) => (restaurantId ? d.restaurantId === restaurantId : true))
      .filter((d) => hit(d.name))
      .map((dish) => ({
        dish,
        restaurantName: dish.restaurantId ? (restMap.get(dish.restaurantId) ?? null) : null,
      }))
  }, [name, dishesQuery.data, restsQuery.data, restaurantId])

  return { matches, loading: dishesQuery.isLoading || restsQuery.isLoading }
}

// ── 写操作 mutations ─────────────────────────────────────────────────────────

function invalidateAfterWrite(qc: ReturnType<typeof useQueryClient>, scope: DataChangeScope) {
  void qc.invalidateQueries({ queryKey: ['restaurants'] })
  void qc.invalidateQueries({ queryKey: ['dishes'] })
  void qc.invalidateQueries({ queryKey: ['logs'] })
  emitDataChanged(scope)
}

/** 删除一条打卡（仓储内部联动重算 dish/restaurant 派生字段；EC-DEX-03） */
export function useDeleteLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string) => {
      const layer = await getDataLayer()
      await layer.repos.logs.remove(logId)
    },
    onSuccess: () => invalidateAfterWrite(qc, 'log'),
  })
}

/** 切换菜品避雷状态（避雷库撤销与手动避雷共用，EC-INS-03） */
export function useSetAvoid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dishId, avoid }: { dishId: string; avoid: boolean }) => {
      const layer = await getDataLayer()
      await layer.repos.dishes.setAvoid(dishId, avoid)
    },
    onSuccess: () => invalidateAfterWrite(qc, 'dish'),
  })
}

/** 删除店铺（EC-DEX-04：keepLogs=true 保留历史打卡） */
export function useDeleteRestaurant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, keepLogs }: { id: string; keepLogs: boolean }) => {
      const layer = await getDataLayer()
      await layer.repos.restaurants.remove(id, { keepLogs })
    },
    onSuccess: () => invalidateAfterWrite(qc, 'restaurant'),
  })
}

/** 编辑店铺基础信息 */
export function useUpdateRestaurant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Restaurant, 'name' | 'city' | 'district' | 'address' | 'aliases'>>
    }) => {
      const layer = await getDataLayer()
      await layer.repos.restaurants.update(id, patch)
    },
    onSuccess: () => invalidateAfterWrite(qc, 'restaurant'),
  })
}

/** 手动新增店铺（图鉴空态/店铺页 CTA 兜底） */
export function useCreateRestaurant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; city?: string; district?: string }) => {
      const layer = await getDataLayer()
      return layer.repos.restaurants.create(input)
    },
    onSuccess: () => invalidateAfterWrite(qc, 'restaurant'),
  })
}

export type { Dish, Restaurant }
