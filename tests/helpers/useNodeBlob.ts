/**
 * 必须在 `fake-indexeddb/auto` 之前作为首个 import 引入（ESM 按源顺序求值）。
 *
 * jsdom 注入的 Blob/File 与 Node realm 不一致，fake-indexeddb 通过全局
 * structuredClone 克隆记录时会把它们当普通对象，读回后 Blob slot 丢失
 * （size/arrayBuffer 不可用或为空）。统一替换为 Node 原生实现。
 * 参考：fake-indexeddb README 关于 jsdom + structuredClone 的说明。
 */
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

const g = globalThis as { Blob?: unknown; File?: unknown }

if (g.Blob !== NodeBlob) {
  globalThis.Blob = NodeBlob as typeof Blob
}
if (g.File !== NodeFile) {
  globalThis.File = NodeFile as unknown as typeof File
}

export {}
