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
