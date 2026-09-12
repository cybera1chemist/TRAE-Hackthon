/**
 * BFF HTTP adapter（生产默认链路，T2-01）。
 *
 * 浏览器 POST 同源 /api/ai/:endpoint，body 为 OpenAI 兼容对话体但【不含 model】；
 * BFF 负责注入模型名与供应商 Key、限流/no-store/体限制，并原样透传供应商响应。
 * prompt 与 zod 校验全部留在浏览器侧（见 chatProvider.ts），BFF 对消息体透明。
 */
import type { AIProvider } from '../types'
import type { VocabPayload } from '../prompts'
import { buildChatBody, postJson, type ChatCompletionRaw, type ChatSpec } from './openaiChat'
import { createChatProvider, type AiEndpointName, type ChatTransport } from './chatProvider'

/** 与 BFF（dev 中间件 / FC function）的路径约定 */
export const BFF_ENDPOINT_PATH: Record<AiEndpointName, string> = {
  recognize: 'recognize',
  menuScan: 'menu-scan',
  tags: 'tags',
  cardCopy: 'card-copy',
}

/** BFF 未回显 raw.model 时的兜底名（真机联调后供应商会在响应体回显 model） */
const FALLBACK_MODEL: Record<AiEndpointName, string> = {
  recognize: 'qwen-vl-max',
  menuScan: 'qwen-vl-ocr',
  tags: 'qwen-vl-plus',
  cardCopy: 'qwen-max',
}

export interface BffHttpProviderOptions {
  /** 默认同源 /api/ai（Vite dev 中间件 / 生产反代）；也可指向独立部署的 FC 域名 */
  baseUrl?: string
  vocab?: VocabPayload
  fetchImpl?: typeof fetch
}

export function createBffHttpProvider(options: BffHttpProviderOptions = {}): AIProvider {
  const baseUrl = (options.baseUrl ?? '/api/ai').replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl

  const transport: ChatTransport = {
    vendor: 'bff',
    fallbackModel: (endpoint: AiEndpointName) => FALLBACK_MODEL[endpoint],
    invoke(
      endpoint: AiEndpointName,
      spec: ChatSpec,
      signal?: AbortSignal,
    ): Promise<ChatCompletionRaw> {
      // 不带 model：服务端按端点注入，浏览器无法指定任意（昂贵）模型
      const body = buildChatBody(spec)
      return postJson(`${baseUrl}/${BFF_ENDPOINT_PATH[endpoint]}`, body, {
        signal,
        fetchImpl,
      })
    },
  }

  return createChatProvider({ transport, vocab: options.vocab })
}
