/**
 * FoodDex · 本地开发 BFF 中间件（Agent-2 准备区草稿）
 *
 * 对应任务：T2-01（dev 部分；生产 BFF 见同目录 alibaba-fc/README）
 * 调研结论：本地开发不部署任何云平台，挂到 Vite configureServer 上，
 *   从 .env.local 读 AI_VENDOR_API_KEY，转发到 Qwen DashScope。
 *
 * 用法（在 vite.config.ts 中，由 Agent-0 接管正式工程时合入）：
 *   import { createDevBffMiddleware } from './agent2-prep/bff/dev-middleware'
 *   export default defineConfig({
 *     plugins: [react()],
 *     server: { middlewareMode: false },
 *     configureServer(server) {
 *       server.middlewares.use(createDevBffMiddleware({
 *         vendorBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
 *         vendorModel: { recognize: 'qwen-vl-max', ocr: 'qwen-vl-ocr',
 *                        tags: 'qwen-vl-plus', copy: 'qwen3.8-max' },
 *       }))
 *     },
 *   })
 *
 * 安全：
 *   - Key 从 process.env 读，绝不下发浏览器
 *   - Cache-Control: no-store
 *   - 限流：内存令牌桶 60 req/min/IP
 *   - 请求体上限 100MB（10 张 × 10MB worst case）
 *   - 仅 dev 用，生产用 alibaba-fc/index.ts
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

export type AiEndpoint = 'recognize' | 'menu-scan' | 'tags' | 'card-copy'

export interface DevBffOptions {
  /** 供应商 baseURL；默认 DashScope */
  vendorBaseUrl?: string
  /** 各端点对应的模型名 */
  vendorModel: {
    recognize: string
    ocr: string
    tags: string
    copy: string
  }
  /** 可选：自定义 Key 来源（默认 process.env.AI_VENDOR_API_KEY） */
  apiKey?: string
  /** 限流：默认 60/min */
  rateLimitPerMinute?: number
  /** 请求体硬上限；默认 100MB */
  maxBodyBytes?: number
}

interface RateBucket {
  count: number
  resetAt: number
}

const ENDPOINT_PATH = /^\/api\/ai\/(recognize|menu-scan|tags|card-copy)$/

export function createDevBffMiddleware(opts: DevBffOptions) {
  const vendorBaseUrl = opts.vendorBaseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const apiKey = opts.apiKey ?? process.env.AI_VENDOR_API_KEY
  const rateLimit = opts.rateLimitPerMinute ?? 60
  const maxBody = opts.maxBodyBytes ?? 100 * 1024 * 1024
  const buckets = new Map<string, RateBucket>()

  if (!apiKey) {
    // 不抛错，启动时友好提示
    console.warn(
      '[dev-bff] AI_VENDOR_API_KEY 未设置，/api/ai/* 将全部返回 503。请在 .env.local 配置。',
    )
  }

  return async function devBff(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    if (!req.url) return next()
    const match = req.url.match(ENDPOINT_PATH)
    if (!match) return next()
    const endpoint = match[1] as AiEndpoint

    // CORS（dev only，生产由静态托管方处理）
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'method not allowed' }))
      return
    }

    // no-store
    res.setHeader('Cache-Control', 'no-store')

    // 限流
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local')
    const now = Date.now()
    let bucket = buckets.get(ip)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 }
      buckets.set(ip, bucket)
    }
    if (bucket.count >= rateLimit) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate_limited', retryAfter: Math.ceil((bucket.resetAt - now) / 1000) }))
      return
    }
    bucket.count += 1

    // 收集 body
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > maxBody) {
        res.writeHead(413, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'payload_too_large', max: maxBody }))
        return
      }
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString('utf8')

    if (!apiKey) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'dev_bff_no_key', message: 'AI_VENDOR_API_KEY missing in .env.local' }))
      return
    }

    // 选择模型
    const modelMap: Record<AiEndpoint, string> = {
      recognize: opts.vendorModel.recognize,
      'menu-scan': opts.vendorModel.ocr,
      tags: opts.vendorModel.tags,
      'card-copy': opts.vendorModel.copy,
    }
    const model = modelMap[endpoint]

    // 将前端 FoodDEX 形态的请求体转为 DashScope OpenAI 兼容 chat/completions
    const upstreamBody = buildUpstreamBody(endpoint, model, body)
    if (!upstreamBody) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad_request', message: 'invalid body for ' + endpoint }))
      return
    }

    try {
      const upstream = await fetch(`${vendorBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(upstreamBody),
      })

      const text = await upstream.text()
      if (!upstream.ok) {
        res.writeHead(upstream.status, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: 'vendor_error',
            status: upstream.status,
            body: text,
          }),
        )
        return
      }

      // 将供应商响应转回 FoodDex 形态（v1.0 草稿：仅透传，由前端 zod 校验失败抛 BAD_OUTPUT）
      // 真实实现需 vendor-specific 解析（提取 tool_calls.function.arguments 或 message.content 中的 JSON）
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(translateDownstream(endpoint, text))
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: 'network',
          message: (e as Error).message,
        }),
      )
    }
  }
}

// ─── 请求/响应转接（vendor-specific 草稿，待真机联调替换）────────────

interface UpstreamBody {
  model: string
  messages: Array<{ role: string; content: unknown }>
  response_format?: { type: 'json_object' }
  temperature?: number
}

function buildUpstreamBody(endpoint: AiEndpoint, model: string, _body: string): UpstreamBody | null {
  // v1.0 草稿：仅占位骨架。真实实现需要：
  //   - 解析 _body 拿到 images[] + context/dishName 等
  //   - 把图片 data URL 转成 OpenAI multimodal message 形态
  //     [{ type: 'text', text: system + user }, { type: 'image_url', image_url: { url: dataUrl } }]
  //   - system 文本来自 agent2-prep/infra/ai/prompts/*.v1.ts
  return {
    model,
    messages: [
      { role: 'system', content: `[TODO: inject ${endpoint} prompt from agent2-prep/infra/ai/prompts/]` },
      { role: 'user', content: '[TODO: inject images + structured fields from request body]' },
    ],
    response_format: { type: 'json_object' },
    temperature: endpoint === 'card-copy' ? 0.9 : 0.2,
  }
}

function translateDownstream(_endpoint: AiEndpoint, upstreamText: string): string {
  // v1.0 草稿：解析 OpenAI 形态 { choices[0].message.content } 为 JSON 字符串，
  // 然后重塑为 FoodDex DTO（recognize/menu-scan/tags/copy）。
  // 真实实现需对每个 endpoint 用对应 zod schema 解析 + 字段映射。
  // 这里直接透传，由前端 zod 拒收并抛 BAD_OUTPUT 触发降级。
  return upstreamText
}
