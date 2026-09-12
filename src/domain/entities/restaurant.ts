import type { ID, ISODate, SyncState } from './common'

/** 店铺派生统计（PRD §7.2） */
export interface RestaurantStats {
  dishTotal: number
  unlockedCount: number
  avoidCount: number
  avgRating: number | null
  logCount: number
}

/** 店铺（PRD §7.2；dishIds 为冗余便于列表，以 dishes.restaurantId 为准重算） */
export interface Restaurant {
  id: ID
  name: string
  aliases: string[]
  city?: string
  district?: string
  address?: string
  coverPhotoId?: ID
  dishIds: ID[]
  stats: RestaurantStats
  createdAt: ISODate
  updatedAt: ISODate
  syncState: SyncState
}
