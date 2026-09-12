/**
 * 阿里云函数计算 FC（cn-shanghai，首选生产部署，与 DashScope 同区）入口。
 *
 * HTTP 触发器 nodejs18+ runtime 的 (req, res, context) 即 Node http 形态，
 * 直接复用 Node 适配；环境变量在 FC 控制台配置：
 *   AI_VENDOR_API_KEY（必填）
 *   AI_VENDOR_BASE_URL（可选，默认 DashScope 兼容端点）
 *
 * 注意：FC HTTP 触发器请求体上限 32MB（与核心默认 maxBodyBytes 对齐）。
 */
import { createNodeAiHandler } from '../node/serve'

export const handler = createNodeAiHandler({
  apiKey: process.env.AI_VENDOR_API_KEY,
  vendorBaseUrl: process.env.AI_VENDOR_BASE_URL,
})
