/**
 * Dexie Schema v1（TDD §4.1）—— Agent-1 T1-01
 *
 * 迁移规则（TDD §4.3）：
 *  - 每个版本一个 db.version(n).stores(...) + .upgrade(tx => ...)；
 *  - 迁移幂等可重入；迁移内禁止 AI/网络；大批量回填分批（每批 200 行）；
 *  - 发版前以 v(n-1) 真实数据快照做升级回放测试。
 */

/** 当前业务库 schema 版本（备份导入导出校验也引用它） */
export const DB_NAME = 'fooddex'
export const BLOB_DB_NAME = 'fooddex-blobs'
export const SCHEMA_VERSION = 1

/** v1 stores（索引口径与 TDD §4.1 完全一致） */
export const SCHEMA_V1 = {
  userProfile: 'id',
  restaurants: 'id, name, updatedAt',
  dishes: 'id, restaurantId, canonicalDishId, status, isAvoid, unlockedAt, updatedAt',
  logs: 'id, dishId, restaurantId, ateAt, createdAt',
  photos: 'id, refType, refId, isCover, createdAt',
  menuScans: 'id, restaurantId, status, createdAt',
  ocrItems: 'id, scanId, sourceImageId, matchResult.type',
  tagVocab: 'key, dim',
  drafts: 'id, type, updatedAt',
  statCache: 'key',
  jobs: 'id, type, status, runAt',
  kv: 'key',
} as const

/** 图片二进制独立库（与业务库不同事务域，TDD §4.1：不与业务记录同事务耦合） */
export const BLOB_SCHEMA = {
  blobs: 'key, createdAt',
} as const

// ── 非实体表的最小记录形状（owner Agent 可追加字段，不影响既有索引） ──────────

export interface TagVocabRecord {
  key: string
  dim: string
  canonical: string
  updatedAt: string
}

export type DraftType = 'capture' | 'menu_scan'

export interface DraftRecord {
  id: string
  type: DraftType
  payload: unknown
  updatedAt: string
  /** 24h 草稿过期时间点（ISO），到期由清理任务删除 */
  expiresAt?: string
}

export interface StatCacheRecord {
  key: string
  data: unknown
  /** 口径版本 + 数据 hash，用于失效判定（TDD §3.5 SWR） */
  dataVersion: number
  hash?: string
  updatedAt: string
}

/** AsyncQueue 持久化任务（Agent-2 queue 的存储形状，字段保持与其 types 对齐） */
export interface JobRecord {
  id: string
  type: string
  status: 'queued' | 'running' | 'done' | 'failed'
  runAt: string
  payload: unknown
  attempts: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface KvRecord {
  key: string
  value: unknown
  updatedAt: string
}
