/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AI 调用模式：bff（默认）/ direct（仅开发） */
  readonly VITE_AI_MODE?: 'bff' | 'direct'
  readonly VITE_AI_BASE_URL?: string
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
