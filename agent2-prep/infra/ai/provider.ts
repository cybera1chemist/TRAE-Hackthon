/**
 * FoodDex · AIProviderRouter 路由骨架（Agent-2 准备区草稿）
 *
 * 对应任务：T0-06（router 部分）/ T2-01
 * 对应接口：AIProvider (src/infra/ai/types.ts，Agent-0 已冻结)
 *
 * 职责（TDD §5.1）：
 *   circuitBreaker → retry → timeout(AbortController) → adapter
 *
 * v1.0 简化策略：
 *   - circuitBreaker 暂以"连续失败计数 + 30s 冷却"实现，不引第三方库
 *   - retry：仅 NETWORK/TIMEOUT/RATE_LIMITED（由契约 RETRIABLE_CODES 决定），
 *     最多 1 次，抖动退避 800–1600ms（PRD 6.2 不允许多次）
 *   - timeout：使用契约 AI_TIMEOUT_MS（recognize 15s / menuScan 20s / tags 10s / cardCopy 10s）
 *   - 错误归一化：所有原生错误转 AIError(code, message?, vendorCode?)
 *
 * ⚠️ 这是骨架草稿。真实供应商 Adapter（QwenAdapter/DoubaoAdapter）由
 * adapters/ 目录单独实现，本文件只负责编排与归一化。
 * 正式工程位置：src/infra/ai/provider.ts（Agent-2 名下目录）。
 */

import {
  AIError,
  AI_TIMEOUT_MS,
  RETRIABLE_CODES,
  type AIProvider,
  type CopyReq,
  type CopyResp,
  type MenuScanReq,
  type MenuScanResp,
  type RecognizeReq,
  type RecognizeResp,
  type TagReq,
  type TagResp,
} from '@/infra/ai/types'

// ─── 超时配置：直接使用契约 AI_TIMEOUT_MS ──────────────────────────

type Endpoint = keyof AIProvider

const timeoutFor = (endpoint: Endpoint): number => {
  switch (endpoint) {
    case 'recognizeDish':
      return AI_TIMEOUT_MS.recognize
    case 'scanMenu':
      // 注：契约为静态 20s；若需按图片数伸缩，需提 issue 给 Agent-0 改契约
      return AI_TIMEOUT_MS.menuScan
    case 'extractTags':
      return AI_TIMEOUT_MS.tags
    case 'generateCardCopy':
      return AI_TIMEOUT_MS.cardCopy
  }
}

// ─── 错误归一化（对齐 Agent-0 的 AIError 三参构造）────────────────

const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) ||
  (e instanceof Error && e.name === 'AbortError')

const isNetworkError = (e: unknown): boolean =>
  e instanceof TypeError || (e instanceof Error && /network|fetch failed|ECONN/i.test(e.message))

const httpStatusToCode = (status: number): AIError['code'] => {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'NETWORK' // 5xx 视为可重试网络问题
  return 'UNKNOWN'
}

/** 将任意错误归一为 AIError；若已是 AIError 则原样返回 */
export function normalizeError(e: unknown): AIError {
  if (e instanceof AIError) return e
  if (isAbortError(e)) {
    return new AIError('TIMEOUT', 'AI request timed out')
  }
  if (isNetworkError(e)) {
    return new AIError('NETWORK', `Network error: ${(e as Error).message}`)
  }
  // HTTP 响应错误：adapter 应抛带 status 的对象
  if (
    e &&
    typeof e === 'object' &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  ) {
    const err = e as { status: number; body?: unknown; message?: string }
    const code = httpStatusToCode(err.status)
    return new AIError(code, err.message ?? `HTTP ${err.status}`, String(err.status))
  }
  // zod 校验失败：adapter 在解析阶段抛 ZodError
  if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'ZodError') {
    return new AIError('BAD_OUTPUT', 'AI response failed schema validation')
  }
  return new AIError('UNKNOWN', (e as Error)?.message ?? 'Unknown AI error')
}

// ─── 超时 + 用户取消 ───────────────────────────────────────────────

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => {
    if (!ctrl.signal.aborted) ctrl.abort(new DOMException('AI timeout', 'TimeoutError'))
  }, timeoutMs)

  if (outerSignal) {
    if (outerSignal.aborted) {
      ctrl.abort(outerSignal.reason ?? new DOMException('aborted by user', 'AbortError'))
    } else {
      outerSignal.addEventListener(
        'abort',
        () => ctrl.abort(outerSignal.reason ?? new DOMException('aborted by user', 'AbortError')),
        { once: true },
      )
    }
  }

  try {
    return await fn(ctrl.signal)
  } finally {
    clearTimeout(timer)
  }
}

// ─── 重试（最多 1 次，抖动 800–1600ms）─────────────────────────────

const jitter = (min = 800, max = 1600) => min + Math.random() * (max - min)

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const err = e instanceof AIError ? e : normalizeError(e)
    if (!RETRIABLE_CODES.includes(err.code)) throw err
    await new Promise((r) => setTimeout(r, jitter()))
    return fn() // 不递归，仅 1 次
  }
}

// ─── 简易熔断（连续失败 N 次后冷却期内直接短路）────────────────────

class CircuitBreaker {
  private consecutiveFailures = 0
  private cooldownUntil = 0
  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  isOpen(): boolean {
    return Date.now() < this.cooldownUntil
  }

  onSuccess() {
    this.consecutiveFailures = 0
    this.cooldownUntil = 0
  }

  onFailure() {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.threshold) {
      this.cooldownUntil = Date.now() + this.cooldownMs
    }
  }
}

// ─── Router 主类 ───────────────────────────────────────────────────

export interface AIProviderRouterOptions {
  /** 实际供应商 adapter（QwenAdapter / DoubaoAdapter / createMockAIProvider()） */
  adapter: AIProvider
  /** 关闭熔断（测试常用） */
  disableCircuitBreaker?: boolean
}

export class AIProviderRouter implements AIProvider {
  private breaker = new CircuitBreaker()

  constructor(private opts: AIProviderRouterOptions) {}

  private async run<T>(
    endpoint: Endpoint,
    outerSignal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!this.opts.disableCircuitBreaker && this.breaker.isOpen()) {
      throw new AIError('RATE_LIMITED', 'Circuit breaker open (too many recent failures)')
    }
    const timeoutMs = timeoutFor(endpoint)
    try {
      const result = await withRetry(() => withTimeout(fn, timeoutMs, outerSignal))
      this.breaker.onSuccess()
      return result
    } catch (e) {
      this.breaker.onFailure()
      throw e instanceof AIError ? e : normalizeError(e)
    }
  }

  recognizeDish(req: RecognizeReq, signal?: AbortSignal): Promise<RecognizeResp> {
    return this.run('recognizeDish', signal, (s) => this.opts.adapter.recognizeDish(req, s))
  }

  scanMenu(req: MenuScanReq, signal?: AbortSignal): Promise<MenuScanResp> {
    return this.run('scanMenu', signal, (s) => this.opts.adapter.scanMenu(req, s))
  }

  extractTags(req: TagReq, signal?: AbortSignal): Promise<TagResp> {
    return this.run('extractTags', signal, (s) => this.opts.adapter.extractTags(req, s))
  }

  generateCardCopy(req: CopyReq, signal?: AbortSignal): Promise<CopyResp> {
    return this.run('generateCardCopy', signal, (s) => this.opts.adapter.generateCardCopy(req, s))
  }
}
