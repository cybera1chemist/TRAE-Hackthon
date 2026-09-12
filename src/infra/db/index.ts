/**
 * 数据层组装入口（T1-01，TDD §7.2 降级矩阵）—— Agent-1
 *
 * createDataLayer()：
 *  - IndexedDB 可用 → Dexie 业务库 + IDB BlobStore（真实持久化）；
 *  - 不可用（隐私模式等）→ 内存 Repository + 内存 BlobStore，mode='memory'，
 *    UI 须强提示「数据无法持久化，请导出备份」并禁用大图存储。
 */
import type { BlobStore, Repositories } from '@/infra/db/repositories'
import { FoodDexDatabase } from './database'
import { createDexieRepositories } from './dexieRepositories'
import { detectIndexedDb } from './idbDetect'
import { createInMemoryRepositories } from './__inmemory__'
import { IdbBlobStore } from '@/infra/blob/IdbBlobStore'

export type DataLayerMode = 'idb' | 'memory'

export interface DataLayer {
  mode: DataLayerMode
  repos: Repositories
  blobStore: BlobStore
  /** mode='idb' 时存在，关闭/删除库（测试与"清空数据"）使用 */
  db?: FoodDexDatabase
  /** 尝试持久化授权的结果（仅 idb 模式有意义） */
  persisted: boolean
}

export interface CreateDataLayerOptions {
  /** 强制模式（测试可指定 'memory'；'idb' 在环境不支持时仍会降级） */
  force?: DataLayerMode
  /** 是否在 idb 模式下请求 navigator.storage.persist 授权，默认 true */
  requestPersistence?: boolean
  /** 自定义业务库名（测试隔离） */
  dbName?: string
}

export async function createDataLayer(options: CreateDataLayerOptions = {}): Promise<DataLayer> {
  const { force, requestPersistence = true, dbName } = options

  const idbAvailable = force === 'memory' ? false : await detectIndexedDb()

  if (!idbAvailable) {
    const mem = createInMemoryRepositories()
    return { mode: 'memory', repos: mem.repos, blobStore: mem.blobStore, persisted: false }
  }

  const db = new FoodDexDatabase(dbName)
  // 首次打开若库结构异常会在此抛出，交由应用 ErrorBoundary/启动流程提示
  await db.open()
  const repos = createDexieRepositories(db)
  const blobStore = new IdbBlobStore()

  let persisted = false
  if (requestPersistence) {
    const { persistStorage, isStoragePersisted } = await import('@/infra/blob/IdbBlobStore')
    persisted = (await isStoragePersisted()) || (await persistStorage())
  }

  return { mode: 'idb', repos, blobStore, db, persisted }
}

/** 关闭并彻底删除业务库与图片库（"清空所有数据" / 测试重置） */
export async function destroyDataLayer(layer: DataLayer): Promise<void> {
  if (layer.db) {
    layer.db.close()
    await layer.db.delete()
  }
  // Blob 使用独立库
  const { BlobDatabase } = await import('./database')
  const blobDb = new BlobDatabase()
  await blobDb.delete()
  blobDb.close()
}

export { FoodDexDatabase } from './database'
export { createDexieRepositories } from './dexieRepositories'
export { detectIndexedDb, isIndexedDbPresent } from './idbDetect'
export { SCHEMA_VERSION, DB_NAME, BLOB_DB_NAME, SCHEMA_V1 } from './schema'
export { createInMemoryRepositories } from './__inmemory__'
