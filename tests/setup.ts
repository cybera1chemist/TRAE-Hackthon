// Vitest 全局 setup：提供 jest-dom 断言（toBeInTheDocument 等）
// 注：jsdom Blob/File 与 fake-indexeddb 的兼容处理不在此做全局替换（jsdom 环境
// 重建时序会导致替换不稳定），需要 Blob 持久化的测试请在首个 import 引入
// tests/helpers/useNodeBlob。
import '@testing-library/jest-dom/vitest'
