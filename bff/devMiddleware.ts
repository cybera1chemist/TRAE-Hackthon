/**
 * Vite dev 用 connect 中间件（T2-01 dev 部分）。
 *
 * 用法见 bff/vite.ts 的 aiBffPlugin；Key 从环境变量 AI_VENDOR_API_KEY 读取
 * （由 vite.config 调 loadEnv 后显式传入，或直接依赖进程环境）。
 * 生产：见 bff/fc/index.ts（阿里云 FC）与 bff/cloudflare/worker.ts（海外备选）。
 */
import { createNodeAiHandler } from './node/serve'
import {
  DEFAULT_MODELS,
  DEFAULT_VENDOR_BASE_URL,
  type BffConfig,
  type BffEndpoint,
} from './core/proxy'

export interface DevBffOptions extends BffConfig {
  /** 同 apiKey；显式列出便于 vite.config 处传参 */
  apiKey?: string
}

const warnedKeys = new Set<string>()

export function createDevBffMiddleware(options: DevBffOptions = {}) {
  const apiKey = options.apiKey ?? process.env.AI_VENDOR_API_KEY
  if (!apiKey && !warnedKeys.has('no-key')) {
    warnedKeys.add('no-key')
    console.warn(
      '[fooddex-bff] AI_VENDOR_API_KEY 未设置：/api/ai/* 将返回 503。请在 .env.local 配置。',
    )
  }

  return createNodeAiHandler({
    apiKey,
    vendorBaseUrl:
      options.vendorBaseUrl ?? process.env.AI_VENDOR_BASE_URL ?? DEFAULT_VENDOR_BASE_URL,
    models: { ...DEFAULT_MODELS, ...(options.models ?? {}) },
    rateLimitPerMinute: options.rateLimitPerMinute,
    maxBodyBytes: options.maxBodyBytes,
    now: options.now,
    fetchImpl: options.fetchImpl,
  })
}

export type { BffEndpoint }
