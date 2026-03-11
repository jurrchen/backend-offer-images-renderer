import type { LogContext } from '../logger/index.js'

declare module 'fastify' {
  interface FastifyRequest {
    ctx: LogContext
    requestId: string
  }

  interface FastifySchema {
    tags?: string[]
    security?: Record<string, string[]>[]
  }
}
