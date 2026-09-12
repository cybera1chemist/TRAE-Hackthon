/**
 * AIProvider 工厂（T2-01 组合根）。
 *
 * 模式（VITE_AI_MODE，未设置时默认 mock 以保证离线开发可用）：
 * - mock：纯前端夹具，失败可注入，E2E/离线开发用（不经 Router，避免重试干扰断言）；
 * - bff ：生产默认，经同源 BFF 转发（createBffHttpProvider），外套 Router；
 * - direct：仅开发调试，浏览器直连供应商（需用户自担 Key 泄露风险），外套 Router。
 */
import type { AIProvider } from './types'
import { AIProviderRouter, type AIProviderRouterOptions } from './provider'
import { createMockAIProvider } from './adapters/mock'
import { createBffHttpProvider } from './adapters/bffHttp'
import { createQwenProvider } from './adapters/qwen'
import type { VocabPayload } from './prompts'

export type AIMode = 'mock' | 'bff' | 'direct'

export interface CreateAIOptions {
  /** 缺省取 import.meta.env.VITE_AI_MODE，再缺省 'mock' */
  mode?: AIMode
  /** bff：BFF 根地址（默认读 VITE_AI_BASE_URL）；direct：供应商兼容端点 */
  baseUrl?: string
  /** direct 模式必填的供应商 Key（浏览器侧，仅限开发） */
  apiKey?: string
  /** 受控词表（组合根从 domain/vocab 注入） */
  vocab?: VocabPayload
  fetchImpl?: typeof fetch
  /** Router 调参（测试注入退避/关熔断用） */
  router?: Pick<AIProviderRouterOptions, 'disableCircuitBreaker' | 'retryDelay'>
}

export function createAIProvider(options: CreateAIOptions = {}): AIProvider {
  const envMode = import.meta.env.VITE_AI_MODE as AIMode | undefined
  const mode = options.mode ?? envMode ?? 'mock'
  const envBaseUrl = import.meta.env.VITE_AI_BASE_URL

  if (mode === 'mock') {
    return createMockAIProvider()
  }

  if (mode === 'bff') {
    const adapter = createBffHttpProvider({
      baseUrl: options.baseUrl ?? envBaseUrl,
      vocab: options.vocab,
      fetchImpl: options.fetchImpl,
    })
    return new AIProviderRouter({ adapter, ...(options.router ?? {}) })
  }

  if (mode === 'direct') {
    if (!options.apiKey) {
      throw new Error('createAIProvider: direct 模式需要 apiKey（浏览器直连有泄露风险，仅限开发）')
    }
    const adapter = createQwenProvider({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? envBaseUrl,
      vocab: options.vocab,
      fetchImpl: options.fetchImpl,
    })
    return new AIProviderRouter({ adapter, ...(options.router ?? {}) })
  }

  throw new Error(`createAIProvider: unknown VITE_AI_MODE=${mode as string}`)
}
