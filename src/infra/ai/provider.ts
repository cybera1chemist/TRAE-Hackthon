/**
 * AIProviderRouter（T0-06 实现 / T2-01）。
 * 编排链（TDD §5.1）：circuitBreaker → retry(1) → timeout(AbortController) → adapter。
 * - 超时阈值取冻结契约 AI_TIMEOUT_MS；
 * - 仅 RETRIABLE_CODES（NETWORK/TIMEOUT/RATE_LIMITED）自动重试 1 次，抖动退避；
 *   识别类不多次重试（PRD §6.2）；
 * - 所有原生错误经 normalizeError 归一为 AIError，业务层不感知供应商差异；
 * - 熔断：连续失败 N 次后冷却期内短路，避免弱网/欠费时持续打爆供应商。
 */
import {
  AIError,
  AI_TIMEOUT_MS,
  RETRIABLE_CODES,
  type AIErrorCode,
  type AIProvider,
  type CopyReq,
  type CopyResp,
  type MenuScanReq,
  type MenuScanResp,
  type RecognizeReq,
  type RecognizeResp,
  type TagReq,
  type TagResp,
} from './types'

type Endpoint = keyof AIProvider

const timeoutFor = (endpoint: Endpoint): number => {
  switch (endpoint) {
    case 'recognizeDish':
      return AI_TIMEOUT_MS.recognize
    case 'scanMenu':
      // 冻结契约为单张 20s；多图总时长由 BFF/adapter 内部按图串行控制
      return AI_TIMEOUT_MS.menuScan
    case 'extractTags':
      return AI_TIMEOUT_MS.tags
    case 'generateCardCopy':
      return AI_TIMEOUT_MS.cardCopy
  }
}

// ── 错误归一化 ────────────────────────────────────────────────────────────────

const isAbortError = (e: unknown): boolean =>
  (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) ||
  (e instanceof Error && e.name === 'AbortError')

const isNetworkError = (e: unknown): boolean =>
  e instanceof TypeError || (e instanceof Error && /network|fetch failed|ECONN/i.test(e.message))

const httpStatusToCode = (status: number): AIErrorCode => {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'NETWORK' // 5xx 视为可重试的上游故障
  return 'UNKNOWN'
}

/** adapter 可抛出携带 HTTP status 的错误，由本函数识别 */
export interface HttpLikeError {
  status: number
  message?: string
  body?: unknown
}

const isHttpLikeError = (e: unknown): e is HttpLikeError =>
  !!e &&
  typeof e === 'object' &&
  'status' in e &&
  typeof (e as { status: unknown }).status === 'number'

/**
 * 将任意错误归一为 AIError。已是 AIError 原样返回（保留 adapter 已标注的语义）。
 * zod 校验失败（name==='ZodError'）归一为 BAD_OUTPUT。
 */
export function normalizeError(e: unknown): AIError {
  if (e instanceof AIError) return e
  if (isAbortError(e)) {
    return new AIError('TIMEOUT', 'AI request timed out')
  }
  if (isNetworkError(e)) {
    return new AIError('NETWORK', `Network error: ${(e as Error).message}`)
  }
  if (isHttpLikeError(e)) {
    const code = httpStatusToCode(e.status)
    return new AIError(code, e.message ?? `HTTP ${e.status}`, String(e.status))
  }
  if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'ZodError') {
    return new AIError('BAD_OUTPUT', 'AI response failed schema validation')
  }
  return new AIError('UNKNOWN', (e as Error)?.message ?? 'Unknown AI error')
}

// ── 超时 + 用户取消 ──────────────────────────────────────────────────────────

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<T> {
  // 调用方传入的信号已中止：不创建定时器、不调用 adapter，快速失败（重试第二轮也走这里）
  if (outerSignal?.aborted) {
    throw new DOMException('aborted by user', 'AbortError')
  }
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

// ── 重试（最多 1 次，抖动 800–1600ms）────────────────────────────────────────

const jitter = (min = 800, max = 1600) => min + Math.random() * (max - min)

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const err = e instanceof AIError ? e : normalizeError(e)
    if (!RETRIABLE_CODES.includes(err.code)) throw err
    await new Promise((r) => setTimeout(r, jitter()))
    return fn() // 仅重试 1 次，不递归
  }
}

// ── 简易熔断 ──────────────────────────────────────────────────────────────────

class CircuitBreaker {
  private consecutiveFailures = 0
  private cooldownUntil = 0

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  isOpen(now: number = Date.now()): boolean {
    return now < this.cooldownUntil
  }

  onSuccess(): void {
    this.consecutiveFailures = 0
    this.cooldownUntil = 0
  }

  onFailure(now: number = Date.now()): void {
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.threshold) {
      this.cooldownUntil = now + this.cooldownMs
    }
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export interface AIProviderRouterOptions {
  /** 实际供应商 adapter（qwen / bff-http / mock） */
  adapter: AIProvider
  /** 关闭熔断（单测常用） */
  disableCircuitBreaker?: boolean
  /** 注入退避函数（单测可置为立即执行）；默认 800–1600ms 随机抖动 */
  retryDelay?: () => Promise<void>
}

export class AIProviderRouter implements AIProvider {
  private breaker = new CircuitBreaker()

  constructor(private readonly opts: AIProviderRouterOptions) {}

  private async run<T>(
    endpoint: Endpoint,
    outerSignal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (!this.opts.disableCircuitBreaker && this.breaker.isOpen()) {
      throw new AIError('RATE_LIMITED', 'Circuit breaker open (too many recent failures)')
    }
    const timeoutMs = timeoutFor(endpoint)
    const delay = this.opts.retryDelay
    try {
      const result = delay
        ? await this.runWithInjectedDelay(fn, timeoutMs, outerSignal, delay)
        : await withRetry(() => withTimeout(fn, timeoutMs, outerSignal))
      this.breaker.onSuccess()
      return result
    } catch (e) {
      this.breaker.onFailure()
      throw e instanceof AIError ? e : normalizeError(e)
    }
  }

  /** 测试用：用注入的 delay 替换默认抖动 */
  private runWithInjectedDelay<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    outerSignal: AbortSignal | undefined,
    delay: () => Promise<void>,
  ): Promise<T> {
    const attempt = () => withTimeout(fn, timeoutMs, outerSignal)
    return attempt().catch(async (e) => {
      const err = e instanceof AIError ? e : normalizeError(e)
      if (!RETRIABLE_CODES.includes(err.code)) throw err
      await delay()
      return attempt()
    })
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
