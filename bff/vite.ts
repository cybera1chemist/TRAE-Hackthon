/**
 * Vite 插件：dev server 挂载 AI BFF 中间件（仅 serve 阶段，build 零影响）。
 *
 * vite.config.ts 接线示例（由组合根传入 loadEnv 的值）：
 *   import { aiBffPlugin } from './bff/vite'
 *   plugins: [react(), aiBffPlugin({ apiKey: env.AI_VENDOR_API_KEY })]
 */
import type { Plugin } from 'vite'
import { createDevBffMiddleware, type DevBffOptions } from './devMiddleware'

export function aiBffPlugin(options: DevBffOptions = {}): Plugin {
  return {
    name: 'fooddex-ai-bff',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createDevBffMiddleware(options))
    },
  }
}
