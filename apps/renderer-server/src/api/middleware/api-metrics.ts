import type { FastifyInstance } from 'fastify'
import { analytics } from '../../utils/analytics.js'

export async function apiMetricsPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onResponse', async (request, reply) => {
    // Skip health probes and non-API paths
    if (request.url.includes('/health') || !request.url.startsWith('/api/')) return

    analytics.logApiMetrics({
      endpoint: request.url,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      requestSizeBytes: request.headers['content-length'] ? parseInt(request.headers['content-length'], 10) : undefined,
      responseSizeBytes: reply.getHeader('content-length') ? parseInt(String(reply.getHeader('content-length')), 10) : undefined,
      requestId: request.requestId,
      userAgent: request.headers['user-agent'],
    }).catch(() => {})
  })
}
