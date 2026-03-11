import winston from 'winston'

export interface LogContext {
  traceID?: string
  workerID?: string
  renderID?: string
  httpMethod?: string
  httpPath?: string
  remoteIP?: string
}

export const rootCtx: LogContext = {}

export function withContext(parent: LogContext, extra: Partial<LogContext>): LogContext {
  return { ...parent, ...extra }
}

const CTX_KEYS = new Set<keyof LogContext>(['traceID', 'workerID', 'renderID', 'httpMethod', 'httpPath', 'remoteIP'])
const isDev = process.env.NODE_ENV !== 'production'
// NOTE: logger initialises before config (used at module scope everywhere),
// so we read process.env directly here — this is the only exception.
const level = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info')

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ level, message, timestamp, ...rest }) => {
    const ctxParts: string[] = []
    const extraParts: Record<string, unknown> = {}

    for (const [k, v] of Object.entries(rest)) {
      if (CTX_KEYS.has(k as keyof LogContext)) {
        ctxParts.push(`${k}=${v}`)
      } else {
        extraParts[k] = v
      }
    }

    const ctxStr = ctxParts.length ? ` [${ctxParts.join(' ')}]` : ''
    const extraStr = Object.keys(extraParts).length ? ` ${JSON.stringify(extraParts)}` : ''
    return `${timestamp} ${level}${ctxStr} ${message}${extraStr}`
  })
)

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  // Rename message → msg per JSON output spec
  winston.format((info) => {
    ;(info as any).msg = info.message
    delete (info as any).message
    return info
  })(),
  winston.format.json()
)

const winstonLogger = winston.createLogger({
  level,
  format: isDev ? devFormat : prodFormat,
  transports: [new winston.transports.Console()],
})

type LogFields = Record<string, unknown>

function serializeFields(fields?: LogFields): LogFields {
  if (!fields) return {}
  const { error, ...rest } = fields as { error?: unknown } & LogFields
  if (error instanceof Error) {
    return { ...rest, error: { name: error.name, message: error.message, stack: error.stack } }
  }
  return fields
}

function buildMeta(ctx: LogContext, fields?: LogFields): LogFields {
  const ctxFields = ctx ? Object.fromEntries(
    Object.entries(ctx).filter(([, v]) => v !== undefined)
  ) : {}
  return { ...ctxFields, ...serializeFields(fields) }
}

function log(logLevel: string, ctx: LogContext, msg: string, fields?: LogFields): void {
  winstonLogger.log(logLevel, msg, buildMeta(ctx, fields))
}

export const logger = {
  debug: (ctx: LogContext, msg: string, fields?: LogFields) => log('debug', ctx, msg, fields),
  info:  (ctx: LogContext, msg: string, fields?: LogFields) => log('info',  ctx, msg, fields),
  warn:  (ctx: LogContext, msg: string, fields?: LogFields) => log('warn',  ctx, msg, fields),
  error: (ctx: LogContext, msg: string, fields?: LogFields) => log('error', ctx, msg, fields),
}
