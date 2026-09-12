/**
 * AI 基础设施出口（冻结契约消费入口）。
 * 批次 3 用法：`const ai = createMockAIProvider()`；Agent-2 落地后替换为 Router。
 */
export type {
  AIProvider,
  AIErrorCode,
  AIModelInfo,
  BBoxTuple,
  CopyReq,
  CopyResp,
  ExtractedTags,
  MenuOcrLine,
  MenuScanImageResult,
  MenuScanReq,
  MenuScanResp,
  MenuSection,
  RecognizeImageResult,
  RecognizeReq,
  RecognizedDish,
  RecognizeResp,
  TagReq,
  TagResp,
  TagSuggestion,
} from './types'
export { AIError, AI_TIMEOUT_MS, RETRIABLE_CODES } from './types'
export {
  createMockAIProvider,
  mockFixtures,
  setMockAIFailure,
  getMockAIFailure,
  type MockAIOptions,
  type MockFailureMode,
} from './adapters/mock'

// ── Agent-2 落地：Router / adapter / 工厂 ─────────────────────────────────────
export { AIProviderRouter, normalizeError } from './provider'
export type { AIProviderRouterOptions, HttpLikeError } from './provider'
export { createAIProvider, type AIMode, type CreateAIOptions } from './factory'
export { createQwenProvider, DEFAULT_QWEN_MODELS, DASHSCOPE_BASE_URL } from './adapters/qwen'
export type { QwenProviderOptions, QwenModelSet } from './adapters/qwen'
export { createBffHttpProvider, BFF_ENDPOINT_PATH } from './adapters/bffHttp'
export type { BffHttpProviderOptions } from './adapters/bffHttp'
export {
  buildChatBody,
  buildMessages,
  normalizeImage,
  parseChatJson,
  extractContentText,
  VendorHttpError,
} from './adapters/openaiChat'
export type { ChatSpec, ChatCompletionBody, ChatMessage } from './adapters/openaiChat'
export { PROMPT_VERSIONS } from './prompts'
export type { VocabPayload } from './prompts'
