/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 数据层单例（应用组合层，T1-10/T4-01 接线用）。
 *
 * 背景：Agent-1 的 createDataLayer 是工厂，main.tsx/providers 属 Agent-0 目录，
 * Agent-5 无权修改。为保证全应用（dex/insights 页面与 Agent-3 未来的打卡流）
 * 共用同一个 Dexie 实例，这里以模块级懒单例持有数据层；浏览器不支持 IDB 时
 * 工厂自身会降级到内存模式（persisted=false，UI 须提示无法持久化）。
 *
 * 该文件是中立组合代码（无业务口径），Agent-3/Agent-6 可直接复用；
 * 若 Agent-0 后续在 providers 统一注入，可将本单例替换为 Context 而不改调用点。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { createDataLayer, type DataLayer } from '@/infra/db'

let layerPromise: Promise<DataLayer> | null = null

/** 获取全局唯一数据层（懒初始化，重复调用复用同一 Promise） */
export function getDataLayer(): Promise<DataLayer> {
  if (!layerPromise) {
    layerPromise = createDataLayer()
  }
  return layerPromise
}

/** 仅供测试：重置单例（如 force:'memory' 场景） */
export function resetDataLayerForTest(): void {
  layerPromise = null
}

/** 测试注入：用指定选项替换单例 */
export async function initDataLayerForTest(
  options?: Parameters<typeof createDataLayer>[0],
): Promise<DataLayer> {
  layerPromise = createDataLayer(options)
  return layerPromise
}
