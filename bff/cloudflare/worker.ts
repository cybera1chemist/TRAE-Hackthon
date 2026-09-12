/**
 * Cloudflare Workers 入口（海外备选部署，100MB body 上限）。
 *
 * wrangler.toml/vars 或 secrets 配置：
 *   AI_VENDOR_API_KEY（secret）
 *   AI_VENDOR_BASE_URL（可选，默认 DashScope 兼容端点）
 *
 * 限流状态按 isolate 内存保存（与 FC 按实例同理）；多 isolate 下为近似限流。
 */
import { createAiProxy } from '../core/proxy'

export interface CfEnv {
  AI_VENDOR_API_KEY?: string
  AI_VENDOR_BASE_URL?: string
}

export default {
  async fetch(request: Request, env: CfEnv): Promise<Response> {
    const handle = createAiProxy({
      apiKey: env.AI_VENDOR_API_KEY,
      vendorBaseUrl: env.AI_VENDOR_BASE_URL,
    })
    return handle(request)
  },
}
