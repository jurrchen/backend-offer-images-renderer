/**
 * In-memory store for async render jobs.
 */

import type { BatchRenderResponse } from '../api/schemas.js'

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface RenderJob {
  id: string
  status: JobStatus
  request: Record<string, unknown>
  result?: BatchRenderResponse
  metadata?: {
    generatorId?: string
    generatorSource?: string
    colorsUsed?: string[]
    viewsUsed?: string[]
    regionsUsed?: string[]
    printMethod?: string
  }
  error?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
}

import { config } from '../config/index.js'

const JOB_RESULT_TTL_MS = config.jobStore.resultTtlMs
const MAX_STORED_JOBS = config.jobStore.maxStoredJobs

const jobs = new Map<string, RenderJob>()

function cleanStale(): void {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now - new Date(job.createdAt).getTime() > JOB_RESULT_TTL_MS) {
      jobs.delete(id)
    }
  }
  // Evict oldest if over capacity
  if (jobs.size > MAX_STORED_JOBS) {
    const entries = [...jobs.entries()].sort(
      (a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime(),
    )
    const toRemove = entries.slice(0, jobs.size - MAX_STORED_JOBS)
    for (const [id] of toRemove) {
      jobs.delete(id)
    }
  }
}

export function createJob(id: string, request: Record<string, unknown>): void {
  cleanStale()
  jobs.set(id, {
    id,
    status: 'pending',
    request,
    createdAt: new Date().toISOString(),
  })
}

export function startJob(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'processing'
  job.startedAt = new Date().toISOString()
}

export function completeJob(
  id: string,
  result: BatchRenderResponse,
  metadata?: RenderJob['metadata'],
): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'completed'
  job.result = result
  if (metadata) job.metadata = metadata
  job.completedAt = new Date().toISOString()
  if (job.startedAt) {
    job.durationMs = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
  }
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'failed'
  job.error = error
  job.completedAt = new Date().toISOString()
  if (job.startedAt) {
    job.durationMs = new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
  }
}

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id)
}
