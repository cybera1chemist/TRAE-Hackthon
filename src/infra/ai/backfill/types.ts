/**
 * T4-04 历史标签批量补全 —— 数据端口。
 *
 * 与 JobStore 同策略：不改动 Agent-0/Agent-1 的冻结 repositories 签名，
 * 由组合根（main.tsx 接线层）用 Repositories + BlobStore 实现本端口。
 */
import type { ID } from '@/domain/entities/common'
import type { Tag } from '@/domain/entities/tag'

/** 待补全日志的扁平视图（端口负责 join Dish 名称） */
export interface BackfillLogView {
  logId: ID
  dishId: ID
  dishName: string
  comment?: string
  scene?: string
}

/** 单轮进度（同时作为 Job.payload 检查点，页面刷新后可展示） */
export interface BackfillProgress {
  /** 本轮启动时剩余待处理总数（pending + 可选 failed） */
  total: number
  /** 本轮已处理（成功+失败） */
  processed: number
  succeeded: number
  failed: number
  failedIds: ID[]
}

export interface BackfillDataPort {
  /**
   * 拉下一批待处理日志（按时间正序）；状态 done 的不返回 —— 天然支持续跑。
   * includeFailed=true 时连历史 failed 一起重试。
   */
  listPendingLogs(opts: { includeFailed: boolean; limit: number }): Promise<BackfillLogView[]>

  /**
   * 读取日志关联图片的 data URL（PhotoRepo + BlobStore 适配）；
   * 图片缺失/不可读时返回空数组（标签 prompt 支持无图降级，不因此判失败）。
   */
  loadImageDataUrls(logId: ID): Promise<string[]>

  /**
   * 成功落库：写 AI 标签并把 Log.tagExtractionState 置 done。
   * 实现侧合并约定：保留 source='user' 的标签；以 (dim,value) 去重后
   * 用本次 AI 结果替换旧 AI 标签（重跑不产生重复）。
   */
  markDone(logId: ID, tags: Tag[]): Promise<void>

  /** 单条失败：置 Log.tagExtractionState='failed'（可被下一轮 includeFailed 重试） */
  markFailed(logId: ID): Promise<void>

  /** 剩余计数（进度 total） */
  countRemaining(includeFailed: boolean): Promise<number>
}
