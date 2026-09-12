import { describe, expect, it, vi } from 'vitest'
import { AIError } from '@/infra/ai/types'
import {
  buildChatBody,
  extractContentText,
  normalizeImage,
  parseChatJson,
  postJson,
  VendorHttpError,
  type ChatCompletionRaw,
} from '@/infra/ai/adapters/openaiChat'
import { createQwenProvider } from '@/infra/ai/adapters/qwen'
import { createBffHttpProvider } from '@/infra/ai/adapters/bffHttp'

// ── fetch 夹具 ────────────────────────────────────────────────────────────────

interface FetchCall {
  url: string
  init: RequestInit
}

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  }
}

function mockFetch(payload: unknown, status = 200) {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return jsonResponse(payload, status)
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

const RECOGNIZE_CONTENT = {
  results: [
    {
      imageIndex: 0,
      imageQuality: { blur: false, hasFood: true },
      dishes: [
        {
          name: '水煮牛肉',
          confidence: 0.91,
          candidates: ['水煮牛肉', '水煮鱼'],
          bbox: [12, 34, 560, 780],
        },
      ],
    },
  ],
}

const vendorOk = (content: unknown): ChatCompletionRaw => ({
  id: 'chatcmpl-test-1',
  model: 'qwen-vl-max',
  choices: [{ message: { content: JSON.stringify(content) } }],
})

describe('openaiChat 原语', () => {
  it('normalizeImage：裸 base64 补 data URL；data:/http URL 原样返回', () => {
    expect(normalizeImage('QUJD')).toBe('data:image/jpeg;base64,QUJD')
    expect(normalizeImage('data:image/png;base64,QUJD')).toBe('data:image/png;base64,QUJD')
    expect(normalizeImage('https://x.com/a.jpg')).toBe('https://x.com/a.jpg')
  })

  it('buildChatBody：system+多模态 user；带 model 与 json_mode', () => {
    const body = buildChatBody(
      { system: 'S', userText: 'U', images: ['QUJD'], temperature: 0.1 },
      'qwen-vl-max',
    )
    expect(body.model).toBe('qwen-vl-max')
    expect(body.temperature).toBe(0.1)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]).toEqual({ role: 'system', content: 'S' })
    expect(body.messages[1]?.content).toEqual([
      { type: 'text', text: 'U' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    ])
  })

  it('buildChatBody：无图时 user 为纯文本；jsonMode=false 不下发 response_format；无 model 时省略', () => {
    const body = buildChatBody({ system: 'S', userText: 'U', jsonMode: false })
    expect(body.model).toBeUndefined()
    expect(body.response_format).toBeUndefined()
    expect(body.messages[1]?.content).toBe('U')
  })

  it('parseChatJson：兼容纯 JSON / ```json 代码块 / 前后缀文字', () => {
    expect(parseChatJson({ choices: [{ message: { content: '{"a":1}' } }] })).toEqual({ a: 1 })
    expect(parseChatJson({ choices: [{ message: { content: '```json\n{"a":2}\n```' } }] })).toEqual(
      { a: 2 },
    )
    expect(
      parseChatJson({
        choices: [{ message: { content: '好的，结果如下：\n{"a":3}\n以上。' } }],
      }),
    ).toEqual({ a: 3 })
  })

  it('parseChatJson：支持 content 分块数组与 tool_calls.arguments 兜底', () => {
    expect(
      parseChatJson({
        choices: [{ message: { content: [{ type: 'text', text: '{"a":4}' }] } }],
      }),
    ).toEqual({ a: 4 })
    expect(
      parseChatJson({
        choices: [
          { message: { content: null, tool_calls: [{ function: { arguments: '{"a":5}' } }] } },
        ],
      }),
    ).toEqual({ a: 5 })
  })

  it('parseChatJson：空内容/非法 JSON 抛 BAD_OUTPUT（不重试码）', () => {
    expect(() => parseChatJson({ choices: [{ message: { content: '' } }] })).toThrow(AIError)
    try {
      parseChatJson({ choices: [{ message: { content: 'not json at all' } }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(AIError)
      expect((e as AIError).code).toBe('BAD_OUTPUT')
      expect((e as AIError).retriable).toBe(false)
    }
  })

  it('extractContentText 容忍缺失 choices', () => {
    expect(extractContentText({})).toBe('')
    expect(extractContentText({ choices: [] })).toBe('')
  })

  it('postJson：成功返回解析后的 JSON，并透传 signal 与自定义 header', async () => {
    const { fetchImpl, calls } = mockFetch({ ok: true })
    const ac = new AbortController()
    const out = await postJson(
      'https://x.test/v1/chat/completions',
      { messages: [] },
      { signal: ac.signal, headers: { authorization: 'Bearer k' }, fetchImpl },
    )
    expect(out).toEqual({ ok: true })
    expect(calls[0]?.url).toBe('https://x.test/v1/chat/completions')
    expect(calls[0]?.init.signal).toBe(ac.signal)
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: 'Bearer k',
      'content-type': 'application/json',
    })
  })

  it('postJson：401 + OpenAI 错误信封 → VendorHttpError（status/vendorCode 供 Router 归一）', async () => {
    const { fetchImpl } = mockFetch({ error: { code: 'invalid_api_key', message: 'bad key' } }, 401)
    await expect(postJson('https://x.test', { messages: [] }, { fetchImpl })).rejects.toMatchObject(
      {
        name: 'VendorHttpError',
        status: 401,
        vendorCode: 'invalid_api_key',
        message: 'bad key',
      },
    )
  })

  it('postJson：网络层 TypeError 原样抛出（Router 归一为 NETWORK）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(
      postJson('https://x.test', { messages: [] }, { fetchImpl }),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('VendorHttpError 形状兼容 Router 的 HttpLikeError', () => {
    const e = new VendorHttpError(429, 'slow down', { error: {} }, 'Throttling')
    expect(e.status).toBe(429)
    expect(e.vendorCode).toBe('Throttling')
  })
})

describe('createQwenProvider（direct）', () => {
  it('recognizeDish：直连 DashScope，body 带 model 与 Bearer，出参 zod 校验并映射 DTO', async () => {
    const { fetchImpl, calls } = mockFetch(vendorOk(RECOGNIZE_CONTENT))
    const ai = createQwenProvider({
      apiKey: 'sk-test',
      fetchImpl,
      baseURL: 'https://dashscope.test/v1/',
    })
    const resp = await ai.recognizeDish({ images: ['QUJD'] })

    expect(resp.requestId).toBe('chatcmpl-test-1')
    expect(resp.model).toEqual({ vendor: 'dashscope', version: 'qwen-vl-max' })
    expect(resp.results[0]?.dishes[0]?.name).toBe('水煮牛肉')

    const req = calls[0]!
    expect(req.url).toBe('https://dashscope.test/v1/chat/completions')
    expect(req.init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    const body = JSON.parse(req.init.body as string)
    expect(body.model).toBe('qwen-vl-max')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0]?.content).toContain('中餐视觉识别专家')
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,QUJD')
  })

  it('scanMenu：走 qwen-vl-ocr 且不下发 response_format', async () => {
    const content = {
      results: [
        {
          imageIndex: 0,
          sections: [
            {
              name: '招牌菜',
              items: [{ name: '水煮牛肉', price: 58, confidence: 0.92, bbox: [1, 2, 3, 4] }],
            },
          ],
          unreadableRegions: [],
        },
      ],
    }
    const { fetchImpl, calls } = mockFetch({ ...vendorOk(content), model: 'qwen-vl-ocr' })
    const ai = createQwenProvider({ apiKey: 'sk', fetchImpl })
    const resp = await ai.scanMenu({ images: ['img'] })
    expect(resp.results[0]?.sections[0]?.items[0]?.price).toBe(58)
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.model).toBe('qwen-vl-ocr')
    expect(body.response_format).toBeUndefined()
  })

  it('extractTags：注入受控词表，输出经 tagRespSchema 校验', async () => {
    const content = {
      tags: {
        taste: [{ value: '麻辣', confidence: 0.88 }],
        cuisine: { primary: { value: '川菜', confidence: 0.8 } },
      },
    }
    const { fetchImpl, calls } = mockFetch(vendorOk(content))
    const ai = createQwenProvider({
      apiKey: 'sk',
      fetchImpl,
      vocab: {
        version: 'v1',
        taste: ['麻辣'],
        cuisine: ['川菜'],
        ingredient: [],
        cooking: [],
        scene: [],
      },
    })
    const resp = await ai.extractTags({ dishName: '水煮牛肉' })
    expect(resp.tags.taste?.[0]?.value).toBe('麻辣')
    expect(JSON.parse(calls[0]!.init.body as string).messages[1]?.content).toContain('麻辣')
  })

  it('generateCardCopy：文案行数组解析', async () => {
    const { fetchImpl } = mockFetch(vendorOk({ lines: ['新图鉴解锁！', '辣味收集度 45%'] }))
    const ai = createQwenProvider({ apiKey: 'sk', fetchImpl })
    const resp = await ai.generateCardCopy({
      dishName: '水煮牛肉',
      template: 'dex_rare',
      rating: 5,
    })
    expect(resp.lines).toHaveLength(2)
  })

  it('供应商返回缺字段 → zod 拒收抛 BAD_OUTPUT', async () => {
    const bad = { results: [{ imageIndex: 0 }] } // 缺 imageQuality/dishes
    const { fetchImpl } = mockFetch(vendorOk(bad))
    const ai = createQwenProvider({ apiKey: 'sk', fetchImpl })
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  it('供应商 429 透传 VendorHttpError（交 Router 决定重试）', async () => {
    const { fetchImpl } = mockFetch({ error: { code: 'Throttling', message: '慢一点' } }, 429)
    const ai = createQwenProvider({ apiKey: 'sk', fetchImpl })
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({
      name: 'VendorHttpError',
      status: 429,
    })
  })

  it('无 apiKey 直接构造报错', () => {
    expect(() => createQwenProvider({ apiKey: '' })).toThrow(/apiKey is required/)
  })
})

describe('createBffHttpProvider（经 BFF）', () => {
  it('recognize：POST 同源路径，body 不含 model、不带 authorization', async () => {
    const { fetchImpl, calls } = mockFetch(vendorOk(RECOGNIZE_CONTENT))
    const ai = createBffHttpProvider({ fetchImpl })
    const resp = await ai.recognizeDish({ images: ['QUJD'] })
    expect(resp.results[0]?.dishes[0]?.name).toBe('水煮牛肉')

    const req = calls[0]!
    expect(req.url).toBe('/api/ai/recognize')
    expect(req.init.headers).not.toHaveProperty('authorization')
    const body = JSON.parse(req.init.body as string)
    expect(body.model).toBeUndefined()
  })

  it('menu-scan/tags/card-copy 路径正确，可自定义 baseUrl（去掉尾斜杠）', async () => {
    const calls: FetchCall[] = []
    const payloads = [vendorOk({ results: [] }), vendorOk({ tags: {} }), vendorOk({ lines: [] })]
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse(payloads[calls.length - 1])
    }) as unknown as typeof fetch
    const ai = createBffHttpProvider({ baseUrl: 'https://fc.test/api/ai/', fetchImpl })
    await ai.scanMenu({ images: [] })
    await ai.extractTags({ dishName: 'x' })
    await ai.generateCardCopy({ dishName: 'x', template: 'michelin_blank' })
    expect(calls.map((c) => c.url)).toEqual([
      'https://fc.test/api/ai/menu-scan',
      'https://fc.test/api/ai/tags',
      'https://fc.test/api/ai/card-copy',
    ])
  })

  it('BFF 返回错误信封（503 no_key）→ VendorHttpError', async () => {
    const { fetchImpl } = mockFetch({ error: 'dev_bff_no_key', message: 'missing key' }, 503)
    const ai = createBffHttpProvider({ fetchImpl })
    await expect(ai.recognizeDish({ images: [] })).rejects.toMatchObject({ status: 503 })
  })

  it('signal 透传（用户取消）', async () => {
    const { fetchImpl, calls } = mockFetch(vendorOk(RECOGNIZE_CONTENT))
    const ai = createBffHttpProvider({ fetchImpl })
    const ac = new AbortController()
    await ai.recognizeDish({ images: [] }, ac.signal)
    expect(calls[0]?.init.signal).toBe(ac.signal)
  })
})
