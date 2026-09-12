/**
 * Mock adapter（分工文档 §3 交付物：Agent-0 初版 → Agent-2 实现）。
 * - 固定夹具：对齐 TDD §5.2 的 水煮牛肉 示例响应；
 * - 失败注入：E2E/自测可切换 timeout/network/rate_limited/bad_json/no_food；
 * - 失败模式持久化到 localStorage（key 见 MOCK_FAILURE_KEY），E2E 运行时可动态切换。
 * Agent-2 落地真实供应商后，本文件仍保留供 E2E 与离线开发使用（TDD §5.1）。
 */
import type {
  AIProvider,
  CopyReq,
  CopyResp,
  MenuScanReq,
  MenuScanResp,
  RecognizeReq,
  RecognizeResp,
  TagReq,
  TagResp,
} from '../types'
import { AIError } from '../types'
import { copyRespSchema, menuScanRespSchema, recognizeRespSchema, tagRespSchema } from '../schemas'

// ── 失败注入 ─────────────────────────────────────────────────────────────────

export type MockFailureMode =
  'none' | 'timeout' | 'network' | 'rate_limited' | 'bad_json' | 'no_food'

export const MOCK_FAILURE_KEY = 'fooddex.mock.aiFailure'

/** E2E 可直接调用（或 DevTools 里 localStorage.setItem(MOCK_FAILURE_KEY, 'timeout')） */
export function setMockAIFailure(mode: MockFailureMode): void {
  if (typeof localStorage === 'undefined') return
  if (mode === 'none') localStorage.removeItem(MOCK_FAILURE_KEY)
  else localStorage.setItem(MOCK_FAILURE_KEY, mode)
}

export function getMockAIFailure(): MockFailureMode {
  if (typeof localStorage === 'undefined') return 'none'
  return (localStorage.getItem(MOCK_FAILURE_KEY) as MockFailureMode | null) ?? 'none'
}

// ── 固定夹具（TDD §5.2 示例响应） ────────────────────────────────────────────

export const mockFixtures = {
  recognize: {
    requestId: 'req_mock_01',
    results: [
      {
        imageIndex: 0,
        imageQuality: { blur: false, hasFood: true },
        dishes: [
          {
            name: '水煮牛肉',
            confidence: 0.91,
            candidates: ['水煮牛肉', '水煮鱼', '毛血旺'],
            bbox: [120, 80, 900, 760],
          },
          // 中置信样例：用于验证 0.5–0.8 黄档 UI（PRD EC-CAP）
          {
            name: '回锅肉',
            confidence: 0.62,
            candidates: ['回锅肉', '盐煎肉'],
            bbox: [900, 300, 1400, 700],
          },
        ],
      },
    ],
    model: { vendor: 'mock', version: 'vision-mock-1' },
  },
  menuScan: {
    requestId: 'req_mock_02',
    results: [
      {
        imageIndex: 0,
        sections: [
          {
            name: '招牌菜',
            items: [
              {
                name: '水煮牛肉',
                price: 58,
                spec: '例',
                confidence: 0.88,
                bbox: [120, 340, 720, 404],
              },
              {
                name: '夫妻肺片',
                price: 42,
                spec: '例',
                confidence: 0.73,
                bbox: [120, 420, 720, 484],
              },
            ],
          },
          {
            name: '汤羹',
            items: [
              {
                name: '酸辣汤',
                price: 28,
                spec: '例',
                confidence: 0.41,
                bbox: [120, 560, 720, 624],
              },
            ],
          },
        ],
        unreadableRegions: [[40, 900, 1040, 1180]],
      },
    ],
    model: { vendor: 'mock', version: 'ocr-mock-1' },
  },
  tags: {
    tags: {
      taste: [{ value: '麻辣', confidence: 0.93 }],
      cuisine: {
        primary: { value: '川菜', confidence: 0.97 },
        secondary: [{ value: '火锅', confidence: 0.55 }],
      },
      ingredient: [{ value: '牛肉', confidence: 0.9 }],
      cooking: [{ value: '水煮', confidence: 0.8 }],
      scene: [{ value: '聚餐', confidence: 0.7 }],
      custom: [{ value: '下饭', confidence: 0.62 }],
    },
  },
  cardCopy: {
    lines: ['「麻辣 +1，辣味图鉴 45%」', '牛肉滑嫩，麻味够正。'],
  },
} satisfies {
  recognize: RecognizeResp
  menuScan: MenuScanResp
  tags: TagResp
  cardCopy: CopyResp
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export interface MockAIOptions {
  /** 模拟网络延迟，默认 600ms */
  latencyMs?: number
  /** 静态失败模式（优先级低于 localStorage 注入） */
  failure?: MockFailureMode
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })

/**
 * 创建 Mock AIProvider。
 * 识别/扫描/标签均先经过 zod 夹具自校验（防止夹具腐化，语义同 TDD §5.1 输出校验）。
 */
export function createMockAIProvider(options: MockAIOptions = {}): AIProvider {
  const latency = options.latencyMs ?? 600

  async function guard(signal?: AbortSignal): Promise<void> {
    await sleep(latency, signal)
    const mode = getMockAIFailure() === 'none' ? (options.failure ?? 'none') : getMockAIFailure()
    switch (mode) {
      case 'timeout':
        throw new AIError('TIMEOUT', '[mock] injected timeout')
      case 'network':
        throw new AIError('NETWORK', '[mock] injected network failure')
      case 'rate_limited':
        throw new AIError('RATE_LIMITED', '[mock] injected rate limit')
      case 'bad_json':
        // 模拟“供应商返回脏 JSON”：zod 校验失败归一为 BAD_OUTPUT
        try {
          recognizeRespSchema.parse(JSON.parse('{oops not json'))
        } catch {
          throw new AIError('BAD_OUTPUT', '[mock] injected malformed output')
        }
        throw new AIError('BAD_OUTPUT', '[mock] unreachable')
      default:
        return
    }
  }

  return {
    async recognizeDish(_req: RecognizeReq, signal) {
      await guard(signal)
      if (getMockAIFailure() === 'no_food') {
        return recognizeRespSchema.parse({
          ...mockFixtures.recognize,
          results: mockFixtures.recognize.results.map((r) => ({
            ...r,
            imageQuality: { blur: true, hasFood: false },
            dishes: [],
          })),
        })
      }
      return recognizeRespSchema.parse(mockFixtures.recognize)
    },

    async scanMenu(_req: MenuScanReq, signal) {
      await guard(signal)
      return menuScanRespSchema.parse(mockFixtures.menuScan)
    },

    async extractTags(_req: TagReq, signal) {
      await guard(signal)
      return tagRespSchema.parse(mockFixtures.tags)
    },

    async generateCardCopy(req: CopyReq, signal) {
      await guard(signal)
      if (req.avoid) return copyRespSchema.parse({ lines: ['「雷品警报 ⚡：再也不见。」'] })
      return copyRespSchema.parse(mockFixtures.cardCopy)
    },
  }
}
