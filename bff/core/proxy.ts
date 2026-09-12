/**
 * FoodDex AI BFF —— 平台中立 Web 核心（T2-01 生产链路）。
 *
 * 设计原则：
 * - 只做薄代理：浏览器已构造好 OpenAI 兼容对话消息（含版本化 prompt），
 *   BFF 注入模型名与供应商 Key 后转发，响应原样透传，不参与 prompt/DTO 维护；
 * - Key 只存在服务端环境变量（AI_VENDOR_API_KEY），永不下发浏览器；
 * - 安全基线：no-store、60 req/min/IP 内存限流、请求体 32MB 上限、
 *   剥离客户端伪造的 model 字段、仅放行 4 个固定端点。
 *
 * 同一份核心由三处复用：Vite dev 中间件（node/serve）、阿里云 FC（fc）、
 * Cloudflare Workers（cloudflare，海外备选）。
 */

export type BffEndpoint = 'recognize' | 'menu-scan' | 'tags' | 'card-copy'

const ENDPOINTS: readonly BffEndpoint[] = ['recognize', 'menu-scan', 'tags', 'card-copy']

export const AI_API_PREFIX = '/api/ai/'

export const DEFAULT_VENDOR_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

/** 端点 → 模型映射（与浏览器侧兜底保持一致，真实值以服务端环境变量为准） */
export const DEFAULT_MODELS: Record<BffEndpoint, string> = {
  recognize: 'qwen-vl-max',
  'menu-scan': 'qwen-vl-ocr',
  tags: 'qwen-vl-plus',
  'card-copy': 'qwen-max',
}

export interface BffConfig {
  /** 供应商 Key；缺失时所有 AI 请求 503（启动不失败，便于本地先跑 UI） */
  apiKey?: string
  vendorBaseUrl?: string
  models?: Partial<Record<BffEndpoint, string>>
  /** 每 IP 每分钟请求数，默认 60 */
  rateLimitPerMinute?: number
  /** 请求体字节上限，默认 32MB（FC 上海上限同源） */
  maxBodyBytes?: number
  /** 时钟注入（测试） */
  now?: () => number
  /** fetch 注入（测试） */
  fetchImpl?: typeof fetch
}

interface RateBucket {
  count: number
  resetAt: number
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

function jsonResponse(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...(extra ?? {}),
    },
  })
}

function matchEndpoint(pathname: string): BffEndpoint | null {
  if (!pathname.startsWith(AI_API_PREFIX)) return null
  const name = pathname.slice(AI_API_PREFIX.length).replace(/\/+$/, '')
  return (ENDPOINTS as readonly string[]).includes(name) ? (name as BffEndpoint) : null
}

function clientIdOf(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('cf-connecting-ip') ?? 'local'
}

/**
 * 创建 AI 代理处理器（闭包持有限流桶；CF 按 isolate、FC 按实例、dev 按进程）。
 */
export function createAiProxy(config: BffConfig = {}): (req: Request) => Promise<Response> {
  const apiKey = config.apiKey
  const vendorBaseUrl = (config.vendorBaseUrl ?? DEFAULT_VENDOR_BASE_URL).replace(/\/+$/, '')
  const models: Record<BffEndpoint, string> = { ...DEFAULT_MODELS, ...(config.models ?? {}) }
  const rateLimit = config.rateLimitPerMinute ?? 60
  const maxBodyBytes = config.maxBodyBytes ?? 32 * 1024 * 1024
  const now = config.now ?? (() => Date.now())
  const fetchImpl = config.fetchImpl ?? fetch
  const buckets = new Map<string, RateBucket>()

  function takeRateSlot(client: string): { ok: boolean; retryAfter: number } {
    const t = now()
    let bucket = buckets.get(client)
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + 60_000 }
      buckets.set(client, bucket)
    }
    if (bucket.count >= rateLimit) {
      return { ok: false, retryAfter: Math.ceil((bucket.resetAt - t) / 1000) }
    }
    bucket.count += 1
    return { ok: true, retryAfter: 0 }
  }

  return async function handleAiRequest(req: Request): Promise<Response> {
    const pathname = new URL(req.url).pathname
    const endpoint = matchEndpoint(pathname)
    if (!endpoint) return new Response('Not Found', { status: 404 })

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    if (req.method !== 'POST') {
      return jsonResponse(405, { error: 'method_not_allowed' })
    }

    // 限流
    const client = clientIdOf(req)
    const slot = takeRateSlot(client)
    if (!slot.ok) {
      return jsonResponse(
        429,
        { error: 'rate_limited', retryAfter: slot.retryAfter },
        { 'retry-after': String(slot.retryAfter) },
      )
    }

    // 体限制
    const bodyBuf = await req.arrayBuffer()
    if (bodyBuf.byteLength > maxBodyBytes) {
      return jsonResponse(413, {
        error: 'payload_too_large',
        maxBytes: maxBodyBytes,
      })
    }

    if (!apiKey) {
      return jsonResponse(503, {
        error: 'bff_no_key',
        message: 'AI_VENDOR_API_KEY is not configured on the BFF',
      })
    }

    // 解析并校验入站体：必须是带 messages 的对话请求
    let inbound: Record<string, unknown>
    try {
      inbound = JSON.parse(new TextDecoder().decode(bodyBuf)) as Record<string, unknown>
    } catch {
      return jsonResponse(400, { error: 'bad_request', message: 'body is not valid JSON' })
    }
    if (!Array.isArray(inbound.messages)) {
      return jsonResponse(400, {
        error: 'bad_request',
        message: 'messages[] is required (OpenAI-compatible chat body)',
      })
    }

    // 服务端权威注入 model：剥离客户端任何伪造值，防止指定高价模型
    const upstreamBody = { ...inbound, model: models[endpoint] }

    try {
      const upstream = await fetchImpl(`${vendorBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
        signal: req.signal,
      })

      const text = await upstream.text()
      return new Response(text, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store',
          ...CORS_HEADERS,
        },
      })
    } catch (e) {
      // 客户端主动取消不算服务端错误
      if ((e as Error)?.name === 'AbortError') {
        return jsonResponse(499, { error: 'client_closed' })
      }
      return jsonResponse(502, {
        error: 'vendor_unreachable',
        message: (e as Error)?.message ?? 'fetch failed',
      })
    }
  }
}
