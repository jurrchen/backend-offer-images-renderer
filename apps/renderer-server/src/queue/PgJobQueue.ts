/**
 * PgJobQueue — PostgreSQL-backed async job queue via pg-boss.
 *
 * Accepts the new JobRequest schema (multiple generators with sizes, artwork URLs).
 * Rendered PNGs are uploaded via StorageService, completion events via PubSubService.
 *
 * Shutdown order (critical):
 *   1. boss.stop() — drains active job (waits for processJob() which calls workerPool.renderBatch())
 *   2. workerPool.shutdown() — then kills child processes (called by RendererServer after this)
 */

import PgBoss from 'pg-boss'
import pg from 'pg'
import type { WorkerPoolManager } from '../workers/WorkerPoolManager.js'
import type { StorageService } from '../storage/index.js'
import type { PubSubService, JobImageEntry } from '../pubsub/index.js'
import { fourthwallApi } from '../services/FourthwallApiService.js'

import { config } from '../config/index.js'

// ─── Configuration ──────────────────────────────────────────────────────────

const JOB_RETRY_LIMIT = config.jobs.retryLimit
const JOB_EXPIRE_SECONDS = config.jobs.expireSeconds
const JOB_ARCHIVE_AFTER_SECONDS = config.jobs.archiveAfterSeconds

// ─── Types ───────────────────────────────────────────────────────────────────

/** Stored in pg-boss job.data (JSONB) */
export interface RenderJobPayload {
  body: Record<string, unknown>
  requestId?: string
  submittedAt: string
}

/** Stored in pg-boss job.output (JSONB) on success */
export interface RenderJobOutput {
  images: JobImageEntry[]
  metadata: {
    generatorCount: number
    imageCount: number
    durationMs: number
    completedAt: string
  }
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired'

export interface JobListItem {
  id: string
  status: JobStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  imageCount?: number | null
  error?: string
  pollUrl: string
}

export interface JobStatusResponse {
  id: string
  status: JobStatus
  createdAt: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  result?: RenderJobOutput
  error?: string
  pollUrl: string
}

// ─── State mapping ───────────────────────────────────────────────────────────

type PgBossState = 'created' | 'retry' | 'active' | 'completed' | 'expired' | 'cancelled' | 'failed'

function mapState(state: PgBossState): JobStatus {
  switch (state) {
    case 'created':   return 'pending'
    case 'retry':     return 'pending'
    case 'active':    return 'processing'
    case 'completed': return 'completed'
    case 'failed':    return 'failed'
    case 'expired':   return 'expired'
    case 'cancelled': return 'failed'
    default:          return 'pending'
  }
}

// ─── PgJobQueue ──────────────────────────────────────────────────────────────

export class PgJobQueue {
  private boss: PgBoss
  private pool: pg.Pool
  private workerPool: WorkerPoolManager
  private storageService: StorageService | null
  private pubSubService: PubSubService | null

  constructor(
    workerPool: WorkerPoolManager,
    storageService: StorageService | null,
    pubSubService: PubSubService | null,
  ) {
    this.workerPool = workerPool
    this.storageService = storageService
    this.pubSubService = pubSubService

    this.pool = new pg.Pool({ connectionString: config.database.url })

    this.boss = new PgBoss({
      connectionString: config.database.url,
      schema: 'pgboss_renderer',
      archiveCompletedAfterSeconds: JOB_ARCHIVE_AFTER_SECONDS,
      deleteAfterSeconds: JOB_ARCHIVE_AFTER_SECONDS * 2,
    })

    this.boss.on('error', (error) => {
      console.error('❌ [PgJobQueue] pg-boss error:', error)
    })
  }

  /**
   * Start pg-boss and register the render worker.
   * Call after workerPool.initialize() so workers are ready to process.
   */
  async start(): Promise<void> {
    await this.boss.start()
    console.log('✅ [PgJobQueue] pg-boss started')

    await this.boss.work(
      'render',
      { teamSize: 1, teamConcurrency: 1, newJobCheckIntervalSeconds: 2 },
      (job: PgBoss.Job<RenderJobPayload>) => this.processJob(job),
    )

    console.log('✅ [PgJobQueue] Worker registered for "render" queue')
  }

  /**
   * Submit a new render job. Returns the pg-boss job UUID immediately (202 pattern).
   */
  async submit(body: Record<string, unknown>, requestId?: string): Promise<string> {
    const payload: RenderJobPayload = {
      body,
      requestId,
      submittedAt: new Date().toISOString(),
    }

    const jobId = await this.boss.send('render', payload, {
      retryLimit: JOB_RETRY_LIMIT,
      expireInSeconds: JOB_EXPIRE_SECONDS,
    })

    if (!jobId) {
      throw new Error('[PgJobQueue] boss.send() returned null — job not queued')
    }

    return jobId
  }

  /**
   * Poll job status and result. Returns null if not found (or purged).
   */
  async getJob(id: string): Promise<JobStatusResponse | null> {
    let job: any
    try {
      job = await this.boss.getJobById(id)
    } catch (err) {
      throw new Error(`[PgJobQueue] Database error: ${(err as Error).message}`)
    }

    if (!job) return null

    const status = mapState(job.state as PgBossState)

    const response: JobStatusResponse = {
      id: job.id,
      status,
      createdAt: job.createdon
        ? new Date(job.createdon).toISOString()
        : new Date().toISOString(),
      pollUrl: `/api/v1/jobs/${id}`,
    }

    if (job.startedon) response.startedAt = new Date(job.startedon).toISOString()
    if (job.completedon) response.completedAt = new Date(job.completedon).toISOString()

    if (response.startedAt && response.completedAt) {
      response.durationMs =
        new Date(response.completedAt).getTime() - new Date(response.startedAt).getTime()
    }

    if (status === 'completed' && job.output) {
      response.result = typeof job.output === 'string' ? JSON.parse(job.output) : job.output
    }

    if (status === 'failed' && job.output) {
      const out = typeof job.output === 'string' ? JSON.parse(job.output) : job.output
      response.error = out?.message || 'Job failed'
    }

    return response
  }

  /**
   * List recent jobs ordered by creation time descending.
   */
  async listJobs(limit = 50): Promise<JobListItem[]> {
    const { rows } = await this.pool.query(
      `SELECT id, state, createdon, startedon, completedon, output
       FROM pgboss_renderer.job
       WHERE name = 'render'
       ORDER BY createdon DESC
       LIMIT $1`,
      [limit],
    )
    return rows.map((row) => {
      const status = mapState(row.state as PgBossState)
      const item: JobListItem = {
        id: row.id,
        status,
        createdAt: row.createdon ? new Date(row.createdon).toISOString() : new Date().toISOString(),
        pollUrl: `/api/v1/jobs/${row.id}`,
      }
      if (row.startedon) item.startedAt = new Date(row.startedon).toISOString()
      if (row.completedon) item.completedAt = new Date(row.completedon).toISOString()
      if (row.startedon && row.completedon) {
        item.durationMs = new Date(row.completedon).getTime() - new Date(row.startedon).getTime()
      }
      const output = row.output ? (typeof row.output === 'string' ? JSON.parse(row.output) : row.output) : null
      item.imageCount = output?.metadata?.imageCount ?? null
      if (status === 'failed') {
        item.error = output?.message ?? 'Job failed'
      }
      return item
    })
  }

  /**
   * Process a single render job (called by pg-boss worker).
   * For each generator: fetch artwork URLs, render, upload PNGs, expand by sizes.
   * Publishes a JobCompletedEvent on completion.
   */
  private async processJob(job: PgBoss.Job<RenderJobPayload>): Promise<RenderJobOutput | void> {
    const startTime = Date.now()
    const jobId = job.id
    console.log(`[PgJobQueue] Starting job ${jobId}`)

    const { body } = job.data
    const {
      generators,
      images: artworkItems,
      colors: requestedColors,
      views: requestedViews,
      renderSize = 2048,
    } = body as any

    const allPubSubImages: JobImageEntry[] = []

    for (let genIdx = 0; genIdx < generators.length; genIdx++) {
      const { generatorData, sizes } = generators[genIdx] as { generatorData: any; sizes: string[] }

      // Resolve colors and views from generator
      const colors: string[] = requestedColors ?? fourthwallApi.getAutoColors(generatorData)
      const views: string[] = requestedViews ?? fourthwallApi.getAvailableViews(generatorData)
      const defaultRegion = fourthwallApi.getDefaultRegion(generatorData)
      const printMethod: string = (generatorData.regions?.[0] as any)?.productionMethod || 'UNKNOWN'

      // Fetch artwork images from URLs → base64
      const fetchedImages: Array<{ region: string; data: string }> = []
      for (const artItem of artworkItems as Array<{ region: string; url: string }>) {
        const resp = await fetch(artItem.url)
        if (!resp.ok) throw new Error(`Failed to fetch artwork from ${artItem.url}: ${resp.status}`)
        const buf = await resp.arrayBuffer()
        const data = Buffer.from(buf).toString('base64')
        fetchedImages.push({ region: artItem.region ?? defaultRegion, data })
      }

      // Validate regions
      const requestedRegions = fetchedImages.map((img) => img.region)
      try {
        fourthwallApi.validateRegions(generatorData, requestedRegions)
      } catch (err) {
        throw new Error((err as Error).message)
      }

      console.log(
        `[PgJobQueue] job=${jobId} gen[${genIdx}]: ${colors.length} colors × ${views.length} views`,
      )

      // Execute batch render
      const result = await this.workerPool.renderBatch(
        {
          generatorId: generatorData.id,
          images: fetchedImages,
          colors,
          views,
          renderSize,
          generatorData,
        },
        generatorData,
      )

      // Upload each rendered PNG and build pubsub entries
      for (const r of result.results) {
        let url: string

        if (this.storageService) {
          const key = `${jobId}/${genIdx}-${r.color}-${r.view}-${r.region}.png`
          const uploaded = await this.storageService.upload(Buffer.from(r.buffer), key)
          url = uploaded.url
        } else {
          // No storage — store base64 data URL as fallback
          url = `data:image/png;base64,${Buffer.from(r.buffer).toString('base64')}`
        }

        // Expand by sizes — one entry per size for this image
        for (const size of sizes) {
          allPubSubImages.push({
            url,
            size,
            region: r.region,
            color: r.color,
            style: printMethod,
            width: renderSize,
            height: renderSize,
          })
        }
      }
    }

    const duration = Date.now() - startTime
    console.log(
      `[PgJobQueue] job=${jobId}: ${allPubSubImages.length} image entries in ${duration}ms`,
    )

    // Publish completion event
    if (this.pubSubService) {
      try {
        await this.pubSubService.publish({ jobId, images: allPubSubImages })
      } catch (err) {
        // Non-fatal — job output is already being stored in pg
        console.warn(`[PgJobQueue] job=${jobId}: publish failed:`, (err as Error).message)
      }
    }

    return {
      images: allPubSubImages,
      metadata: {
        generatorCount: generators.length,
        imageCount: allPubSubImages.length,
        durationMs: duration,
        completedAt: new Date().toISOString(),
      },
    }
  }

  /**
   * Graceful shutdown — drains the active job before stopping.
   * Must be called BEFORE workerPool.shutdown().
   */
  async shutdown(): Promise<void> {
    console.log('🛑 [PgJobQueue] Stopping pg-boss...')
    await this.boss.stop({ graceful: true, timeout: 10_000 })
    await this.pool.end()
    console.log('✅ [PgJobQueue] pg-boss stopped')
  }
}
