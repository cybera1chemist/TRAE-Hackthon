/**
 * scan-menu feature 出口（Agent-4 专有目录）。
 * 纯逻辑层：供 ScanPage 与未来 workflow 消费；不依赖 Agent-1/2 未交付实现
 * （matcher 通过 DishMatcher 注入，见 lib/diff.ts）。
 */
export type {
  ImagePrecheck,
  MenuLineDraft,
  MenuLineKind,
  ScanDraft,
  ScanImageSlot,
  ScanOcrError,
  ScanPhase,
  UnreadableRegion,
} from './types'
export { toBBox, bboxOverlapRatio, linesInRegion } from './lib/bbox'
export { classifyMenuLine } from './lib/classify'
export { normalizeSpec, mergeSpecPrices } from './lib/prices'
export {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_MENU_IMAGES,
  detectBlur,
  detectExposure,
  laplacianVariance,
  validateImageFiles,
  type GrayImage,
  type ImageFileMeta,
  type ImageRejectReason,
  type ImageValidation,
} from './lib/precheck'
export {
  computeMenuDiff,
  type ComputeDiffOptions,
  type DishMatcher,
  type MenuDiff,
  type RenamedCandidate,
} from './lib/diff'
export { toLineDrafts } from './lib/respToLines'
export { applyDefaultDecisions, resolvableLines, toResolvedItems } from './lib/save'
export {
  canConfirmSave,
  createInitialDraft,
  isDraftFresh,
  pendingLowConfidence,
  scanDraftReducer,
  DRAFT_MAX_AGE_MS,
  type ScanEvent,
} from './machine/scanMachine'
