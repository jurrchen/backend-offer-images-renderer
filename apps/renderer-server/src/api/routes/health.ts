import type { FastifyInstance } from 'fastify'
import { readFileSync } from 'node:fs'
import type { HealthResponse, MemoryMetrics } from '../schemas.js'
import { healthResponseSchema } from '../schemas.js'
import type { WorkerPoolManager } from '../../workers/WorkerPoolManager.js'
import { config } from '../../config/index.js'

const startTime = Date.now()
const MEMORY_PRESSURE_THRESHOLD = 0.85

function readCgroupMemory(): { usedMb: number; limitMb: number } | null {
  try {
    const current = parseInt(readFileSync('/sys/fs/cgroup/memory.current', 'utf-8').trim(), 10)
    const max = readFileSync('/sys/fs/cgroup/memory.max', 'utf-8').trim()
    if (max === 'max') return null
    const limitBytes = parseInt(max, 10)
    if (isNaN(current) || isNaN(limitBytes)) return null
    return {
      usedMb: Math.round(current / (1024 * 1024)),
      limitMb: Math.round(limitBytes / (1024 * 1024)),
    }
  } catch {
    try {
      const current = parseInt(readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf-8').trim(), 10)
      const limit = parseInt(readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf-8').trim(), 10)
      if (isNaN(current) || isNaN(limit)) return null
      if (limit > 1024 * 1024 * 1024 * 1024) return null
      return {
        usedMb: Math.round(current / (1024 * 1024)),
        limitMb: Math.round(limit / (1024 * 1024)),
      }
    } catch {
      return null
    }
  }
}

function getMemoryMetrics(): MemoryMetrics {
  const mem = process.memoryUsage()
  const metrics: MemoryMetrics = {
    rssMb: Math.round(mem.rss / (1024 * 1024)),
    heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
    externalMb: Math.round(mem.external / (1024 * 1024)),
  }

  const cgroup = readCgroupMemory()
  if (cgroup) {
    metrics.containerUsedMb = cgroup.usedMb
    metrics.containerLimitMb = cgroup.limitMb
    metrics.containerUsagePercent = Math.round((cgroup.usedMb / cgroup.limitMb) * 100)
  }

  return metrics
}

export async function healthRoutes(fastify: FastifyInstance, opts: { workerPool: WorkerPoolManager }): Promise<void> {
  const { workerPool } = opts

  fastify.get('/', {
    schema: {
      tags: ['Health'],
      response: { 200: healthResponseSchema },
    },
  }, async (request, reply) => {
    const uptime = (Date.now() - startTime) / 1000
    const poolStatus = workerPool.getStatus()
    const memory = getMemoryMetrics()

    const response: HealthResponse = {
      status: workerPool.isInitialized() ? 'healthy' : 'unhealthy',
      version: '1.0.0-phase1-auth-debug',
      authEnabled: !!config.apiKey,
      renderer: 'js',
      workers: poolStatus.workers,
      workerStatus: {
        idle: poolStatus.workerStatus.idle,
        busy: poolStatus.workerStatus.busy,
      },
      queueDepth: poolStatus.queueDepth,
      uptime,
      memory,
    }

    return reply.code(response.status === 'healthy' ? 200 : 503 as any).send(response)
  })

  fastify.get('/ready', {
    schema: { tags: ['Health'] },
  }, async (request, reply) => {
    if (!workerPool.isInitialized()) {
      return reply.code(503).send({ ready: false, message: 'Worker pool not initialized' })
    }

    const cgroup = readCgroupMemory()
    if (cgroup) {
      const usageRatio = cgroup.usedMb / cgroup.limitMb
      if (usageRatio >= MEMORY_PRESSURE_THRESHOLD) {
        return reply.code(503).send({
          ready: false,
          message: `Memory pressure: ${Math.round(usageRatio * 100)}% of ${cgroup.limitMb}MB limit`,
        })
      }
    }

    return { ready: true }
  })

  fastify.get('/live', {
    schema: { tags: ['Health'] },
  }, async () => {
    return { alive: true }
  })

  fastify.get('/memory', {
    schema: { tags: ['Health'] },
  }, async () => {
    const mem = process.memoryUsage()
    const poolStatus = workerPool.getStatus()
    const cgroup = readCgroupMemory()

    const response: Record<string, unknown> = {
      process: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        external_mb: Math.round(mem.external / 1024 / 1024),
        array_buffers_mb: Math.round(mem.arrayBuffers / 1024 / 1024),
      },
      workers: poolStatus.workers,
      workerStatus: {
        idle: poolStatus.workerStatus.idle,
        busy: poolStatus.workerStatus.busy,
        starting: poolStatus.workerStatus.starting,
        error: poolStatus.workerStatus.error,
      },
      queue_depth: poolStatus.queueDepth,
      totalJobsProcessed: poolStatus.totalJobsProcessed,
      uptime_s: Math.round(process.uptime()),
    }

    if (cgroup) {
      response.container = {
        limit_mb: cgroup.limitMb,
        usage_mb: cgroup.usedMb,
        usage_pct: Math.round((cgroup.usedMb / cgroup.limitMb) * 1000) / 10,
      }
    }

    return response
  })
}
