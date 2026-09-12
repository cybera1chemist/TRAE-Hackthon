/**
 * 领域纯服务统一出口（Agent-1 T1-05）。
 * 全部为无副作用纯函数，可被 Dexie/InMemory 两条仓储链路与 stats worker 复用。
 */
export * from './normalize'
export * from './matcher'
export * from './unlock'
export * from './avoid'
export * from './rating'
export * from './restaurantStats'
export * from './nameGuard'
export * from './stats'
