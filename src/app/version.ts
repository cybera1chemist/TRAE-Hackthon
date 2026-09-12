/** 应用版本：构建时由 VITE_APP_VERSION 注入，开发期为 0.1.0（TDD §9.2） */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.1.0'
