/**
 * 内存假实现出口：批次 3 Agent 在 Agent-1 的 Dexie 版本落地前的唯一数据层。
 * 用法：
 *   const { repos, blobStore } = createInMemoryRepositories()
 *   const ai = createMockAIProvider()
 *   // “假打卡”全链路：repos.restaurants.create → repos.dishes.create →
 *   // ai.recognizeDish(...) → repos.logs.addMany([...])
 * Agent-1 落地真实 Dexie 后，本目录保留用于单测与 jsdom E2E。
 */
export {
  InMemoryDb,
  createInMemoryRepositories,
  makeBlobStore,
  bboxFromTuple,
  type InMemoryDbOptions,
} from './inMemoryDb'
