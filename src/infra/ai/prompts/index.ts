/**
 * Prompt 版本化注册表（T2-02 / TDD §5.3）。
 * 每次 prompt 变更必须新增文件（recognize.v2.ts）并在此登记，
 * 响应经 Log.aiSnapshot / 任务记录可追溯到具体 prompt 版本。
 */
export {
  PROMPT_ID as RECOGNIZE_PROMPT_ID,
  PROMPT_VERSION as RECOGNIZE_PROMPT_VERSION,
  system as recognizeSystem,
  buildUser as buildRecognizeUser,
} from './recognize.v1'
export {
  PROMPT_ID as MENU_SCAN_PROMPT_ID,
  PROMPT_VERSION as MENU_SCAN_PROMPT_VERSION,
  system as menuScanSystem,
  buildUser as buildMenuScanUser,
} from './menu-scan.v1'
export {
  PROMPT_ID as TAGS_PROMPT_ID,
  PROMPT_VERSION as TAGS_PROMPT_VERSION,
  system as tagsSystem,
  buildUser as buildTagsUser,
  type VocabPayload,
  TAG_DIMS,
} from './tags.v1'
export {
  PROMPT_ID as CARD_COPY_PROMPT_ID,
  PROMPT_VERSION as CARD_COPY_PROMPT_VERSION,
  system as cardCopySystem,
  buildUser as buildCardCopyUser,
} from './card-copy.v1'

/** 各端点当前 prompt 版本（写入 aiSnapshot / 任务记录，便于 bad-case 追溯） */
export const PROMPT_VERSIONS = {
  recognize: { id: 'recognize.v1', version: '2026.09.v1' },
  menuScan: { id: 'menu-scan.v1', version: '2026.09.v1' },
  tags: { id: 'tags.v1', version: '2026.09.v1' },
  cardCopy: { id: 'card-copy.v1', version: '2026.09.v1' },
} as const
