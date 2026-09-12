/**
 * 业务数据库（Dexie v1，TDD §4.1）—— Agent-1 T1-01
 */
import Dexie, { type Table } from 'dexie'
import type {
  Dish,
  Log,
  MenuScan,
  OcrItem,
  Photo,
  Restaurant,
  UserProfile,
} from '@/domain/entities'
import {
  BLOB_DB_NAME,
  DB_NAME,
  SCHEMA_VERSION,
  SCHEMA_V1,
  type DraftRecord,
  type JobRecord,
  type KvRecord,
  type StatCacheRecord,
  type TagVocabRecord,
} from './schema'

export class FoodDexDatabase extends Dexie {
  userProfile!: Table<UserProfile, string>
  restaurants!: Table<Restaurant, string>
  dishes!: Table<Dish, string>
  logs!: Table<Log, string>
  photos!: Table<Photo, string>
  menuScans!: Table<MenuScan, string>
  ocrItems!: Table<OcrItem, string>
  tagVocab!: Table<TagVocabRecord, string>
  drafts!: Table<DraftRecord, string>
  statCache!: Table<StatCacheRecord, string>
  jobs!: Table<JobRecord, string>
  kv!: Table<KvRecord, string>

  constructor(name: string = DB_NAME) {
    super(name)
    // v1 初始版本（无 upgrade）。后续版本示例见 schema.ts 注释，TDD §4.3。
    this.version(SCHEMA_VERSION).stores({ ...SCHEMA_V1 })
  }
}

/** 图片 Blob 独立库记录（业务库只在 Photo.blobKey 存引用） */
export interface BlobRecord {
  key: string
  blob: Blob
  sizeBytes: number
  createdAt: string
}

/** 图片二进制独立 Dexie 库（TDD §4.1：与业务大对象解耦） */
export class BlobDatabase extends Dexie {
  blobs!: Table<BlobRecord, string>

  constructor(name: string = BLOB_DB_NAME) {
    super(name)
    this.version(1).stores({ blobs: 'key, createdAt' })
  }
}
