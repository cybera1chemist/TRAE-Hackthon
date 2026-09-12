import type { ID, ISODate } from './common'

/** 图片归属对象类型 */
export type PhotoRefType = 'log' | 'scan' | 'dish'

/**
 * 图片元信息行（PRD §7.6）。
 * 仅存 blobKey 引用，二进制 Blob 由 BlobStore 独立管理，不与业务记录同事务耦合（TDD §4.1）。
 */
export interface Photo {
  id: ID
  refType: PhotoRefType
  refId: ID
  /** 形如 idb://blobs/<key> */
  blobKey: string
  width: number
  height: number
  sizeBytes: number
  isCover: boolean
  createdAt: ISODate
}
