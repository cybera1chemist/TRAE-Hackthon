import { describe, expect, it, vi } from 'vitest'
import { AIError, type AIProvider, type TagReq, type TagResp } from '@/infra/ai/types'
import {
  runBackfillTags,
  flattenExtractedTags,
  type BackfillDataPort,
  type BackfillLogView,
  type BackfillProgress,
} from '@/infra/ai/backfill'
import type { Tag } from '@/domain/entities/tag'

// ── 夹具 ─────────────────────────────────────────────────────────────────────

const TAGS_RESP: TagResp = {
  tags: {
    taste: [{ value: '麻辣', confidence: 0.9 }],
    cuisine: {
      primary: { value: '川菜', confidence: 0.85 },
      secondary: [
        { value: '川菜', confidence: 0.7 }, // 与 primary 同值，去重
        { value: '江湖菜', confidence: 0.66 },
      ],
    },
    custom: [{ value: '下饭', confidence: 0.72 }],
  },
}

function logView(id: string): BackfillLogView {
  return { logId: id, dishId: `d-${id}`, dishName: `菜${id}`, comment: '好辣', scene: '午餐' }
}

interface FakeDataOptions {
  /** listPendingLogs 是否按 done/failed 状态过滤（模拟真实实现）；false 时始终返回全集 */
  stateAware?: boolean
  loadImages?: (logId: string) => Promise<string[]>
}

function makeFakeData(initial: BackfillLogView[], opts: FakeDataOptions = {}) {
  const state = new Map<string, 'pending' | 'done' | 'failed'>(
    initial.map((l) => [l.logId, 'pending']),
  )
  const includeFailedFlags: boolean[] = []
  const doneTags = new Map<string, Tag[]>()
  const failedIds: string[] = []
  const loadedFor: string[] = []

  const port: BackfillDataPort = {
    async countRemaining(includeFailed) {
      return [...state.values()].filter((s) => s === 'pending' || (includeFailed && s === 'failed'))
        .length
    },
    async listPendingLogs({ includeFailed }) {
      includeFailedFlags.push(includeFailed)
      return initial.filter((l) => {
        const s = state.get(l.logId)
        return (
          s === 'pending' || (opts.stateAware === false ? false : includeFailed && s === 'failed')
        )
      })
    },
    async loadImageDataUrls(logId) {
      loadedFor.push(logId)
      return opts.loadImages ? opts.loadImages(logId) : [`img-${logId}`]
    },
    async markDone(logId, tags) {
      state.set(logId, 'done')
      doneTags.set(logId, tags)
    },
    async markFailed(logId) {
      state.set(logId, 'failed')
      failedIds.push(logId)
    },
  }
  return { port, state, doneTags, failedIds, loadedFor, includeFailedFlags }
}

function fakeAi(impl?: (req: TagReq) => Promise<TagResp>) {
  const extractTags = vi.fn(impl ?? (async () => TAGS_RESP))
  return { extractTags } as unknown as Pick<AIProvider, 'extractTags'> & {
    extractTags: ReturnType<typeof vi.fn>
  }
}

describe('flattenExtractedTags', () => {
  it('各维度展平、cuisine primary/secondary 合并去重，全部标 ai 来源', () => {
    const tags = flattenExtractedTags(TAGS_RESP.tags)
    expect(tags).toEqual([
      { dim: 'taste', value: '麻辣', source: 'ai', confidence: 0.9 },
      { dim: 'cuisine', value: '川菜', source: 'ai', confidence: 0.85 },
      { dim: 'cuisine', value: '江湖菜', source: 'ai', confidence: 0.66 },
      { dim: 'custom', value: '下饭', source: 'ai', confidence: 0.72 },
    ])
  })

  it('空 tags 安全', () => {
    expect(flattenExtractedTags({})).toEqual([])
  })
})

describe('runBackfillTags（T4-04）', () => {
  it('正常批处理：逐条取图→提取→落 done，进度逐条回调', async () => {
    const data = makeFakeData([logView('1'), logView('2')])
    const ai = fakeAi()
    const snapshots: BackfillProgress[] = []

    const result = await runBackfillTags(
      { ai, data: data.port, batchSize: 20 },
      undefined,
      async (p) => {
        snapshots.push(p)
      },
    )

    expect(result).toEqual({
      total: 2,
      processed: 2,
      succeeded: 2,
      failed: 0,
      failedIds: [],
    })
    expect(data.doneTags.get('1')).toHaveLength(4)
    expect(data.doneTags.get('2')?.[0]).toMatchObject({ dim: 'taste', value: '麻辣' })
    expect(data.loadedFor).toEqual(['1', '2'])
    expect(ai.extractTags).toHaveBeenCalledTimes(2)
    expect(ai.extractTags.mock.calls[0]![0]).toMatchObject({
      dishName: '菜1',
      comment: '好辣',
      sceneHint: '午餐',
      images: ['img-1'],
    })
    // 初始快照 + 每条一次
    expect(snapshots).toHaveLength(3)
    expect(snapshots.at(-1)?.succeeded).toBe(2)
  })

  it('单条 AI 失败不阻断批次：markFailed 继续，failedIds 汇总', async () => {
    const data = makeFakeData([logView('1'), logView('2'), logView('3')])
    const ai = fakeAi(async (req) => {
      if (req.dishName === '菜2') throw new AIError('NETWORK', 'boom')
      return TAGS_RESP
    })

    const result = await runBackfillTags({ ai, data: data.port, batchSize: 10 })

    expect(result.processed).toBe(3)
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.failedIds).toEqual(['2'])
    expect(data.failedIds).toEqual(['2'])
  })

  it('分页续跑：batchSize=2 处理 5 条，直到无剩余自动停止', async () => {
    const data = makeFakeData(
      [logView('1'), logView('2'), logView('3'), logView('4'), logView('5')],
      { stateAware: true },
    )
    const ai = fakeAi()
    const result = await runBackfillTags({ ai, data: data.port, batchSize: 2 })
    expect(result.total).toBe(5)
    expect(result.succeeded).toBe(5)
    expect(ai.extractTags).toHaveBeenCalledTimes(5)
  })

  it('includeFailed=false 时端口只收到 false 标志', async () => {
    const data = makeFakeData([logView('1')])
    const ai = fakeAi()
    await runBackfillTags({ ai, data: data.port, includeFailed: false })
    expect(data.includeFailedFlags.every((f) => f === false)).toBe(true)
  })

  it('防死循环：即使端口反复返回同一条 failed，本轮也只处理一次后停止', async () => {
    // 非状态感知端口：永远返回同一条（includeFailed=true 时可能发生的朴素实现）
    const data = makeFakeData([logView('x')], { stateAware: false })
    const ai = fakeAi(async () => {
      throw new AIError('NETWORK', 'always down')
    })
    const result = await runBackfillTags({ ai, data: data.port, batchSize: 5 })
    expect(result.processed).toBe(1)
    expect(result.failedIds).toEqual(['x'])
    expect(ai.extractTags).toHaveBeenCalledTimes(1)
  })

  it('图片不可读（空数组）不判失败，仍以无图降级提取', async () => {
    const data = makeFakeData([logView('1')], { loadImages: async () => [] })
    const ai = fakeAi()
    const result = await runBackfillTags({ ai, data: data.port })
    expect(result.succeeded).toBe(1)
    expect(ai.extractTags.mock.calls[0]![0].images).toEqual([])
  })

  it('AbortSignal：开始即中止直接抛 AbortError；处理途中中止立即停且后续落 failed', async () => {
    const aborted = AbortSignal.abort()
    const data1 = makeFakeData([logView('1')])
    await expect(
      runBackfillTags({ ai: fakeAi(), data: data1.port }, aborted),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(data1.doneTags.size).toBe(0)

    const ac = new AbortController()
    const data2 = makeFakeData([logView('1'), logView('2')])
    const ai2 = fakeAi(async () => {
      ac.abort()
      return TAGS_RESP
    })
    await expect(runBackfillTags({ ai: ai2, data: data2.port }, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    // 第 1 条在 markDone 完成后才到下一条的中止检查点；第 2 条不再调 AI
    expect(ai2.extractTags).toHaveBeenCalledTimes(1)
    expect(data2.doneTags.has('1')).toBe(true)
  })
})
