/**
 * 内存 JobStore（T2-05 配套）。
 * 用途：单测、E2E（jsdom 无 IDB）、Agent-1 DexieJobStore 落地前的开发态。
 * 不持久化：刷新即失，生产必须使用 Agent-1 的 DexieJobStore。
 */
import type { JobRecord, JobStatus, JobStore } from './types'

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, JobRecord>()

  async put(job: JobRecord): Promise<void> {
    this.jobs.set(job.id, { ...job, payload: structuredCloneSafe(job.payload) })
  }

  async get(id: string): Promise<JobRecord | undefined> {
    const j = this.jobs.get(id)
    return j ? { ...j, payload: structuredCloneSafe(j.payload) } : undefined
  }

  async listDue(statuses: JobStatus[], now: number): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => statuses.includes(j.status) && j.runAt <= now)
      .sort((a, b) => a.runAt - b.runAt)
      .map((j) => ({ ...j, payload: structuredCloneSafe(j.payload) }))
  }

  async listByStatus(statuses: JobStatus[]): Promise<JobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => statuses.includes(j.status))
      .map((j) => ({ ...j, payload: structuredCloneSafe(j.payload) }))
  }

  async update(id: string, patch: Partial<JobRecord>): Promise<void> {
    const cur = this.jobs.get(id)
    if (!cur) throw new Error(`job not found: ${id}`)
    this.jobs.set(id, { ...cur, ...patch, id: cur.id })
  }

  async remove(id: string): Promise<void> {
    this.jobs.delete(id)
  }

  /** 测试辅助：清空全部任务 */
  reset(): void {
    this.jobs.clear()
  }
}

function structuredCloneSafe<T>(v: T): T {
  if (v === undefined) return v
  try {
    return structuredClone(v)
  } catch {
    return v
  }
}
