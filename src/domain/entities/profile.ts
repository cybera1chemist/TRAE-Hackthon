import type { ISODate } from './common'

/** 出片模板 ID（PRD §8.4：经典图鉴/霓虹夜市/米其林留白） */
export type CardTemplateId = 'dex_rare' | 'neon_market' | 'michelin_blank'

export interface UserPreferences {
  defaultCardTemplate: CardTemplateId
  imageQuality: 'high' | 'balanced' | 'low'
  aiAssistedNaming: boolean
}

export interface UserProfileStats {
  totalLogs: number
  unlockedDishes: number
  restaurants: number
  streakDays: number
}

/** 用户档案与设置（PRD §7.8；本地单用户，id 固定 'me'） */
export interface UserProfile {
  id: 'me'
  nickname: string
  watermark?: string
  preferences: UserPreferences
  stats: UserProfileStats
  onboardedAt?: ISODate
}
