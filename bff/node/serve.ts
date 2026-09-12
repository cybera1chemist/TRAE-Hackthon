/**
 * Node http 适配：把 Node 版 IncomingMessage 转成 Web Request 跑平台中立核心，
 * 再把 Web Response 写回 ServerResponse。
 * dev（Vite connect）与阿里云 FC（HTTP 触发器 nodejs runtime）共用本文件。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { AI_API_PREFIX, createAiProxy, type BffConfig } from '../core/proxy'

export type ConnectNext = (err?: unknown) => void

/** 从 Node 请求头构造 Web Headers（值可能为 string/string[]/undefined） */
function toWebHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else if (typeof value === 'string') {
      headers.set(key, value)
    }
  }
  return headers
}

export function createNodeAiHandler(config: BffConfig = {}) {
  const handle = createAiProxy(config)

  return async function nodeAiHandler(
    req: IncomingMessage,
    res: ServerResponse,
    next?: ConnectNext,
  ): Promise<void> {
    try {
      if (!req.url || !req.url.split('?')[0]?.startsWith(AI_API_PREFIX)) {
        next?.()
        return
      }

      // Node 类型集无 DOM BodyInit 名，用索引访问表达「RequestInit.body」
      type RequestBody = NonNullable<RequestInit['body']>
      const init: RequestInit & { duplex?: 'half' } = {
        method: req.method,
        headers: toWebHeaders(req),
      }
      // GET/HEAD 不能带 body；其余方法把 Node 流转成 Web ReadableStream
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = Readable.toWeb(req) as unknown as RequestBody
        init.duplex = 'half'
      }
      const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, init)
      const response = await handle(request)

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
      const buf = new Uint8Array(await response.arrayBuffer())
      res.end(buf)
    } catch (e) {
      // 核心内部已兜底供应商错误；这里只防转换层意外
      res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'bff_internal', message: (e as Error)?.message }))
    }
  }
}
