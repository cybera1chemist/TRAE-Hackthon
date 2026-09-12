import { afterEach, describe, expect, it } from 'vitest'
import {
  createMockAIProvider,
  getMockAIFailure,
  mockFixtures,
  setMockAIFailure,
  AIError,
} from '@/infra/ai'

/** Mock adapter 契约验证（批次 3 依赖此行为开发，分工 §3 交付物） */
describe('Mock AIProvider', () => {
  afterEach(() => {
    setMockAIFailure('none')
  })

  it('recognizeDish 返回固定夹具（水煮牛肉 0.91）', async () => {
    const ai = createMockAIProvider({ latencyMs: 1 })
    const resp = await ai.recognizeDish({ images: ['base64'], context: { menuHints: ['水煮鱼'] } })
    expect(resp.requestId).toBe(mockFixtures.recognize.requestId)
    expect(resp.results[0]?.dishes[0]).toMatchObject({ name: '水煮牛肉', confidence: 0.91 })
  })

  it('scanMenu / extractTags / generateCardCopy 夹具可用', async () => {
    const ai = createMockAIProvider({ latencyMs: 1 })
    const menu = await ai.scanMenu({ images: ['b64'] })
    expect(menu.results[0]?.sections[0]?.items).toHaveLength(2)
    const tags = await ai.extractTags({ dishName: '水煮牛肉' })
    expect(tags.tags.taste?.[0]?.value).toBe('麻辣')
    const copy = await ai.generateCardCopy({ dishName: '水煮牛肉', template: 'dex_rare' })
    expect(copy.lines.length).toBeGreaterThan(0)
  })

  it('失败注入：timeout/network/bad_json 归一为 AIError', async () => {
    const ai = createMockAIProvider({ latencyMs: 1 })
    setMockAIFailure('timeout')
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({
      code: 'TIMEOUT',
      retriable: true,
    })
    setMockAIFailure('network')
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({ code: 'NETWORK' })
    setMockAIFailure('bad_json')
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({
      code: 'BAD_OUTPUT',
      retriable: false,
    })
  })

  it('no_food 模式返回空菜品', async () => {
    const ai = createMockAIProvider({ latencyMs: 1 })
    setMockAIFailure('no_food')
    const resp = await ai.recognizeDish({ images: [] })
    expect(resp.results[0]?.imageQuality.hasFood).toBe(false)
    expect(resp.results[0]?.dishes).toHaveLength(0)
  })

  it('AbortSignal 可中断等待', async () => {
    const ai = createMockAIProvider({ latencyMs: 5000 })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 10)
    await expect(ai.recognizeDish({ images: [] }, ac.signal)).rejects.toThrow()
  })

  it('AIError 基线：只有 NETWORK/TIMEOUT/RATE_LIMITED 可重试', () => {
    expect(new AIError('NETWORK').retriable).toBe(true)
    expect(new AIError('AUTH').retriable).toBe(false)
    expect(new AIError('NO_FOOD').retriable).toBe(false)
    expect(getMockAIFailure()).toBe('none')
  })
})
