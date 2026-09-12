import { describe, expect, it, vi } from 'vitest'
import { createAiProxy } from '../../bff/core/proxy'

interface VendorCall {
  url: string
  init: RequestInit
}

function mockVendor(payload: unknown, status = 200, contentType = 'application/json') {
  const calls: VendorCall[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': contentType },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const CHAT_BODY = () =>
  JSON.stringify({
    messages: [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

const baseConfig = () => ({
  apiKey: 'sk-server',
  vendorBaseUrl: 'https://vendor.test/v1',
})

describe('BFF AI 代理核心（T2-01）', () => {
  it('正常转发：注入服务端 model + Bearer Key，剥离客户端伪造 model，透传响应与 no-store', async () => {
    const { fetchImpl, calls } = mockVendor({ id: 'c1', choices: [] })
    const handle = createAiProxy({ ...baseConfig(), fetchImpl })

    const req = new Request('http://app/api/ai/recognize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'evil-expensive-model', messages: [] }),
    })
    const res = await handle(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).id).toBe('c1')

    expect(calls[0]?.url).toBe('https://vendor.test/v1/chat/completions')
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer sk-server' })
    const upstream = JSON.parse(calls[0]!.init.body as string)
    expect(upstream.model).toBe('qwen-vl-max') // 服务端权威，非客户端伪造值
  })

  it('四个端点映射各自模型', async () => {
    const { fetchImpl, calls } = mockVendor({ choices: [] })
    const handle = createAiProxy({ ...baseConfig(), fetchImpl })
    const endpoints = ['recognize', 'menu-scan', 'tags', 'card-copy']
    for (const ep of endpoints) {
      await handle(new Request(`http://app/api/ai/${ep}`, { method: 'POST', body: CHAT_BODY() }))
    }
    const models = calls.map((c) => JSON.parse(c.init.body as string).model)
    expect(models).toEqual(['qwen-vl-max', 'qwen-vl-ocr', 'qwen-vl-plus', 'qwen-max'])
  })

  it('未配置 Key → 503 且不打供应商', async () => {
    const { fetchImpl, calls } = mockVendor({})
    const handle = createAiProxy({ vendorBaseUrl: 'https://vendor.test', fetchImpl })
    const res = await handle(
      new Request('http://app/api/ai/tags', { method: 'POST', body: CHAT_BODY() }),
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('bff_no_key')
    expect(calls).toHaveLength(0)
  })

  it('限流：超过 N req/min 返回 429 + retry-after，窗口重置后恢复', async () => {
    let t = 1_000_000
    const { fetchImpl } = mockVendor({ choices: [] })
    const handle = createAiProxy({
      ...baseConfig(),
      fetchImpl,
      rateLimitPerMinute: 2,
      now: () => t,
    })
    const send = () =>
      handle(
        new Request('http://app/api/ai/tags', {
          method: 'POST',
          headers: { 'x-forwarded-for': '1.1.1.1' },
          body: CHAT_BODY(),
        }),
      )

    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const limited = await send()
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()

    // 另一 IP 不受影响
    const other = await handle(
      new Request('http://app/api/ai/tags', {
        method: 'POST',
        headers: { 'x-forwarded-for': '2.2.2.2' },
        body: CHAT_BODY(),
      }),
    )
    expect(other.status).toBe(200)

    // 窗口过去后恢复
    t += 60_001
    expect((await send()).status).toBe(200)
  })

  it('请求体超过上限 → 413', async () => {
    const { fetchImpl } = mockVendor({})
    const handle = createAiProxy({ ...baseConfig(), fetchImpl, maxBodyBytes: 10 })
    const res = await handle(
      new Request('http://app/api/ai/recognize', {
        method: 'POST',
        body: JSON.stringify({ messages: [], pad: 'x'.repeat(100) }),
      }),
    )
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('payload_too_large')
  })

  it('非法 JSON / 缺 messages → 400', async () => {
    const { fetchImpl } = mockVendor({})
    const handle = createAiProxy({ ...baseConfig(), fetchImpl })

    const badJson = await handle(
      new Request('http://app/api/ai/tags', { method: 'POST', body: 'not-json' }),
    )
    expect(badJson.status).toBe(400)

    const noMessages = await handle(
      new Request('http://app/api/ai/tags', {
        method: 'POST',
        body: JSON.stringify({ foo: 1 }),
      }),
    )
    expect(noMessages.status).toBe(400)
  })

  it('GET → 405；OPTIONS → 204 CORS；未知路径 → 404', async () => {
    const handle = createAiProxy(baseConfig())
    const get = await handle(new Request('http://app/api/ai/tags'))
    expect(get.status).toBe(405)

    const options = await handle(new Request('http://app/api/ai/tags', { method: 'OPTIONS' }))
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-origin')).toBe('*')

    const notFound = await handle(new Request('http://app/other', { method: 'POST' }))
    expect(notFound.status).toBe(404)
  })

  it('供应商 429/500 原样透传 status，浏览器侧 Router 据此重试', async () => {
    const r1 = mockVendor({ error: { code: 'Throttling' } }, 429)
    const h1 = createAiProxy({ ...baseConfig(), fetchImpl: r1.fetchImpl })
    expect(
      (await h1(new Request('http://app/api/ai/tags', { method: 'POST', body: CHAT_BODY() })))
        .status,
    ).toBe(429)

    const r2 = mockVendor('boom', 500, 'text/plain')
    const h2 = createAiProxy({ ...baseConfig(), fetchImpl: r2.fetchImpl })
    const res = await h2(
      new Request('http://app/api/ai/tags', { method: 'POST', body: CHAT_BODY() }),
    )
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('供应商网络不可达 → 502 vendor_unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const handle = createAiProxy({ ...baseConfig(), fetchImpl })
    const res = await handle(
      new Request('http://app/api/ai/tags', { method: 'POST', body: CHAT_BODY() }),
    )
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('vendor_unreachable')
  })
})
