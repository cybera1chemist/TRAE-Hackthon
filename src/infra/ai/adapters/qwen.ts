/**
 * Qwen DashScope adapter（T2-02 识别 / T3-02 OCR / T2-01 标签 / T4-05 文案）。
 *
 * 走 DashScope 的 OpenAI 兼容端点（上海直连，无需国际网络）：
 *   POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 *
 * 安全：direct 模式下 Key 出现在浏览器，仅限开发/用户自担风险场景；
 * 生产流量必须走 BFF（createBffHttpProvider），Key 只存在服务端。
 */
import type { AIProvider } from '../types'
import type { VocabPayload } from '../prompts'
import { buildChatBody, postJson, type ChatCompletionRaw, type ChatSpec } from './openaiChat'
import { createChatProvider, type AiEndpointName, type ChatTransport } from './chatProvider'

export const QWEN_VENDOR = 'dashscope'
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export interface QwenModelSet {
  recognize: string
  menuScan: string
  tags: string
  cardCopy: string
}

/** 调研结论（2026-09）：vl-max 识别 / vl-ocr 菜单 OCR / vl-plus 标签 / max 文案 */
export const DEFAULT_QWEN_MODELS: QwenModelSet = {
  recognize: 'qwen-vl-max',
  menuScan: 'qwen-vl-ocr',
  tags: 'qwen-vl-plus',
  cardCopy: 'qwen-max',
}

export interface QwenProviderOptions {
  apiKey: string
  baseURL?: string
  models?: Partial<QwenModelSet>
  /** 受控词表（由组合根从 domain/vocab 注入；不直接 import Agent-1 模块） */
  vocab?: VocabPayload
  fetchImpl?: typeof fetch
}

export function createQwenProvider(opts: QwenProviderOptions): AIProvider {
  if (!opts.apiKey) {
    throw new Error('createQwenProvider: apiKey is required (direct mode is dev-only)')
  }
  const baseURL = (opts.baseURL ?? DASHSCOPE_BASE_URL).replace(/\/+$/, '')
  const models: QwenModelSet = { ...DEFAULT_QWEN_MODELS, ...(opts.models ?? {}) }
  const fetchImpl = opts.fetchImpl

  const transport: ChatTransport = {
    vendor: QWEN_VENDOR,
    fallbackModel: (endpoint: AiEndpointName) => models[endpoint],
    invoke(
      endpoint: AiEndpointName,
      spec: ChatSpec,
      signal?: AbortSignal,
    ): Promise<ChatCompletionRaw> {
      const body = buildChatBody(spec, models[endpoint])
      return postJson(`${baseURL}/chat/completions`, body, {
        signal,
        headers: { authorization: `Bearer ${opts.apiKey}` },
        fetchImpl,
      })
    },
  }

  return createChatProvider({ transport, vocab: opts.vocab })
}
