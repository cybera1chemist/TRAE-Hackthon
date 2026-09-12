/**
 * OpenAI 兼容 Chat Completions 共享原语（T2-01/T2-02）。
 *
 * 同时服务两条链路：
 * - direct：createQwenProvider 直连 DashScope 兼容端点（body 含 model，浏览器自带 Key，仅开发）；
 * - bff：createBffHttpProvider  POST /api/ai/:endpoint（body 不含 model，由 BFF 注入 Key 与模型）。
 *
 * prompt 构造与 zod 校验留在浏览器侧，BFF 对供应商消息体透明，
 * 避免 prompt 在两处维护导致版本漂移（TDD §5.3 可追溯要求）。
 */
import { AIError } from '../types'

// ── 类型 ──────────────────────────────────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type ChatContentPart = ChatTextPart | ChatImagePart

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

export interface ChatCompletionBody {
  /** BFF 模式省略（服务端按端点注入），direct 模式必填 */
  model?: string
  messages: ChatMessage[]
  response_format?: { type: 'json_object' }
  temperature?: number
}

/** 各端点构造一次对话调用所需的全部输入 */
export interface ChatSpec {
  system: string
  userText: string
  /** JPEG base64（可带 data: 前缀）或 http(s) 图片 URL */
  images?: string[]
  temperature?: number
  /** 模型不支持 response_format=json_object（如 qwen-vl-ocr）时置 false */
  jsonMode?: boolean
}

export interface PostOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  /** 测试注入；默认全局 fetch */
  fetchImpl?: typeof fetch
}

/** 携带 HTTP 语义的供应商错误，形状兼容 provider.ts 导出的 HttpLikeError */
export class VendorHttpError extends Error {
  readonly status: number
  readonly body?: unknown
  readonly vendorCode?: string

  constructor(status: number, message: string, body?: unknown, vendorCode?: string) {
    super(message)
    this.name = 'VendorHttpError'
    this.status = status
    this.body = body
    this.vendorCode = vendorCode
  }
}

// ── 请求构造 ──────────────────────────────────────────────────────────────────

/** 裸 base64 补全为 data URL；已是 data:/http(s) URL 原样返回 */
export function normalizeImage(input: string): string {
  if (/^data:/i.test(input) || /^https?:\/\//i.test(input)) return input
  return `data:image/jpeg;base64,${input}`
}

export function buildMessages(spec: ChatSpec): ChatMessage[] {
  const userContent: string | ChatContentPart[] = spec.images?.length
    ? [
        { type: 'text', text: spec.userText },
        ...spec.images.map((url) => ({
          type: 'image_url' as const,
          image_url: { url: normalizeImage(url) },
        })),
      ]
    : spec.userText

  return [
    { role: 'system', content: spec.system },
    { role: 'user', content: userContent },
  ]
}

/** 组装 OpenAI 兼容请求体；model 留空时由 BFF 服务端填充 */
export function buildChatBody(spec: ChatSpec, model?: string): ChatCompletionBody {
  const body: ChatCompletionBody = {
    messages: buildMessages(spec),
    temperature: spec.temperature ?? 0.2,
  }
  if (model) body.model = model
  if (spec.jsonMode !== false) body.response_format = { type: 'json_object' }
  return body
}

// ── 响应解析 ──────────────────────────────────────────────────────────────────

/** DashScope/OpenAI 成功响应的最小结构 */
export interface ChatCompletionRaw {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null
      tool_calls?: Array<{ function?: { arguments?: string } }> | null
    } | null
  }>
  error?: { code?: string; message?: string }
}

/** 从 message.content 提取文本（兼容字符串 / 分块数组 / tool_calls） */
export function extractContentText(raw: ChatCompletionRaw): string {
  const message = raw.choices?.[0]?.message
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) {
    const text = message.content
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('')
    if (text) return text
  }
  const toolArgs = message?.tool_calls?.[0]?.function?.arguments
  if (typeof toolArgs === 'string') return toolArgs
  return ''
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced?.[1] ?? text).trim()
}

function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

/**
 * 解析供应商返回的 JSON 文本。
 * 兼容：纯 JSON / ```json 代码块 / 前后缀解释文字。
 * 任何无法解析的情况抛 BAD_OUTPUT（Router 不再重试，直接走降级）。
 */
export function parseChatJson(raw: ChatCompletionRaw): unknown {
  const text = extractContentText(raw)
  if (!text.trim()) {
    throw new AIError('BAD_OUTPUT', 'AI response has empty content')
  }
  const candidates = [stripCodeFence(text), firstJsonObject(stripCodeFence(text))]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // 尝试下一种形态
    }
  }
  const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text
  throw new AIError('BAD_OUTPUT', `AI output is not valid JSON: ${snippet}`)
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * POST JSON 并返回解析后的响应体。
 * - 网络层故障（TypeError/fetch failed）原样抛出，由 Router 归一为 NETWORK；
 * - 非 2xx 抛 VendorHttpError（status 交 Router 映射 401/403/429/5xx）；
 * - 204/空体返回 null。
 */
export async function postJson(
  url: string,
  body: ChatCompletionBody,
  opts: PostOptions = {},
): Promise<ChatCompletionRaw> {
  const impl = opts.fetchImpl ?? fetch
  const res = await impl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  const text = await res.text()
  if (!res.ok) {
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }
    const vendorMessage =
      (parsed as { error?: { message?: string } })?.error?.message ??
      (parsed as { message?: string })?.message ??
      `Vendor HTTP ${res.status}`
    const vendorCode =
      (parsed as { error?: { code?: string } })?.error?.code ?? (parsed as { code?: string })?.code
    throw new VendorHttpError(res.status, vendorMessage, parsed, vendorCode)
  }

  if (!text) return {}
  try {
    return JSON.parse(text) as ChatCompletionRaw
  } catch {
    throw new AIError('BAD_OUTPUT', 'Vendor response is not valid JSON envelope')
  }
}
