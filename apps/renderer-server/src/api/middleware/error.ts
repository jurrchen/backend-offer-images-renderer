import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify'
import type { ErrorResponse } from '../schemas.js'
import { config } from '../../config/index.js'
import { logger, rootCtx } from '../../logger/index.js'

export function setupErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((err: Error, request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.ctx ?? rootCtx
    logger.error(ctx, 'Unhandled error', { error: err })

    const statusCode = (err as any).statusCode || 500

    const errorResponse: ErrorResponse = {
      error: err.name || 'Internal Server Error',
      message: err.message || 'An unexpected error occurred',
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
    }

    // Don't expose internal error details in non-local environments
    if (!config.isLocal && statusCode === 500) {
      errorResponse.message = 'An unexpected error occurred'
    }

    // Add Retry-After header for 503 responses
    if (statusCode === 503) {
      reply.header('Retry-After', '30')
    }

    reply.code(statusCode).send(errorResponse)
  })

  server.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    reply.code(404).send({
      error: 'Not Found',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
      path: request.url,
    })
  })
}

/**
 * Custom error classes
 */
export class ValidationError extends Error {
  statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends Error {
  statusCode = 401

  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class NotFoundError extends Error {
  statusCode = 404

  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class RenderError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'RenderError'
    this.statusCode = statusCode
  }
}

export class DesignerError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'DesignerError'
    this.statusCode = statusCode
  }
}
