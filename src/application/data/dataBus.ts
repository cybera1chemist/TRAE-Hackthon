/**
 * 数据变更事件总线（应用组合层）。
 *
 * 写事务（打卡 / 删 Log / 避雷切换 / 删店 / 历史补全）成功后 emit，
 * 各视图（TanStack Query 缓存、statCache SWR）订阅失效。
 * Agent-3 的 createLogWorkflow 在事务成功后调用 emitDataChanged('log') 即可联动，
 * 无需跨目录修改 Agent-5 的代码。
 */

export type DataChangeScope = 'restaurant' | 'dish' | 'log' | 'photo' | 'all'

type Listener = (scope: DataChangeScope) => void

const listeners = new Set<Listener>()

export function emitDataChanged(scope: DataChangeScope): void {
  for (const fn of listeners) {
    try {
      fn(scope)
    } catch {
      // 监听者异常不得影响其他订阅与写事务主流程
    }
  }
}

export function subscribeDataChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
