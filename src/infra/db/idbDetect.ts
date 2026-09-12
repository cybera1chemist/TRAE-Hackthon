/**
 * IndexedDB 可用性探测（T1-01，TDD §7.2 降级矩阵）
 *
 * 隐私模式 / 浏览器禁用 IDB 时打开测试库失败 → 返回 false，
 * 调用方降级为内存 Repository 并强提示「数据无法持久化，请导出备份」。
 */
const PROBE_DB = '__fooddex_idb_probe__'

export function isIndexedDbPresent(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.indexedDB !== 'undefined'
}

export function detectIndexedDb(timeoutMs = 2000): Promise<boolean> {
  if (!isIndexedDbPresent()) return Promise.resolve(false)

  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)

    try {
      const req = indexedDB.open(PROBE_DB)
      req.onupgradeneeded = () => {
        // 空库首次创建即视为可用
      }
      req.onsuccess = () => {
        req.result.close()
        try {
          indexedDB.deleteDatabase(PROBE_DB)
        } catch {
          /* 忽略清理失败 */
        }
        clearTimeout(timer)
        finish(true)
      }
      req.onerror = () => {
        clearTimeout(timer)
        finish(false)
      }
      req.onblocked = () => {
        clearTimeout(timer)
        finish(false)
      }
    } catch {
      clearTimeout(timer)
      finish(false)
    }
  })
}
