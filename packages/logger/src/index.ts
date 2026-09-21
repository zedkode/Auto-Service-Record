/**
 * Structured logging with correlation IDs.
 *
 * One correlation ID must trace: HTTP request -> reminder -> job -> email -> webhook.
 * See ARCHITECTURE.md §13.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import pino, { type Logger, type LoggerOptions } from 'pino'

export interface LogContext {
  correlationId?: string
  userId?: string
  workspaceId?: string
  jobId?: string
}

const storage = new AsyncLocalStorage<LogContext>()

/** Run `fn` with a log context that every nested log call inherits. */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const merged = { ...(storage.getStore() ?? {}), ...ctx }
  return storage.run(merged, fn)
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}

/**
 * Paths scrubbed before anything is written. Pino's redact uses path expressions;
 * the wildcards cover nesting at the depths we actually produce.
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  '*.*.password',
  'passwordConfirmation',
  '*.passwordConfirmation',
  'currentPassword',
  '*.currentPassword',
  'newPassword',
  '*.newPassword',
  'token',
  '*.token',
  '*.*.token',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'set-cookie',
  '*.set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
]

export function createLogger(opts: { name: string; level?: string; pretty?: boolean }): Logger {
  const options: LoggerOptions = {
    name: opts.name,
    level: opts.level ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // Every log line inherits the ambient correlation context.
    mixin() {
      const ctx = getLogContext()
      return Object.keys(ctx).length ? ctx : {}
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  }

  if (opts.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    })
  }
  return pino(options)
}

/** Manual scrub for values that go somewhere other than the logger (e.g. audit metadata). */
/**
 * Matches sensitive fragments regardless of separator or case, so `API_KEY`, `api-key`,
 * `apiKey` and `user_password_confirmation` are all caught. Matching a normalised form
 * of the key is what makes this robust — an exact-substring list silently misses variants.
 */
const SENSITIVE_FRAGMENTS = [
  'password',
  'passwd',
  'token',
  'secret',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'session',
  'credential',
  'privatekey',
  'signature',
]

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z]/g, '')
  return SENSITIVE_FRAGMENTS.some((f) => normalised.includes(f))
}

export function sanitiseMetadata(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (input === null || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map((v) => sanitiseMetadata(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[redacted]' : sanitiseMetadata(v, depth + 1)
  }
  return out
}
