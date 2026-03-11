import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { logger } from '../../logger/index.js'
import type { LogContext } from '../../logger/index.js'

export async function requestIdPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('ctx', null as unknown as LogContext)

  fastify.addHook('onRequest', async (request, reply) => {
    const traceID = (request.headers['x-trace-id'] as string) || randomUUID()

    const ctx: LogContext = {
      traceID,
      httpMethod: request.method,
      httpPath: request.url,
      remoteIP: (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || request.ip,
    }

    request.ctx = ctx
    request.requestId = traceID
    reply.header('X-Trace-ID', traceID)

    // Skip request logs for health endpoints to reduce noise
    if (!request.url.startsWith('/api/v1/health')) {
      logger.info(ctx, '→ request')
    }
  })
}
