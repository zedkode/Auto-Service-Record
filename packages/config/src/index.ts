/**
 * Typed, validated environment configuration.
 *
 * The application REFUSES TO START on a missing, malformed, or still-placeholder value.
 * Failing at boot beats discovering at 3am that reminder emails went nowhere for a week.
 * See DEPLOYMENT.md §6.
 */
import { z } from 'zod'

/** Values from .env.example that must never reach a running system. */
const PLACEHOLDER_PATTERNS = [/^CHANGE_ME/i, /^changeme$/i, /^your[-_]/i, /^xxx+$/i]

const notPlaceholder = (label: string) =>
  z
    .string()
    .min(1)
    .refine((v) => !PLACEHOLDER_PATTERNS.some((re) => re.test(v)), {
      message: `${label} is still set to a placeholder value from .env.example. Generate a real value (openssl rand -base64 48).`,
    })

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  )

const port = z.coerce.number().int().min(1).max(65535)

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  MARKETING_URL: z.url().default('http://localhost:3100'),
  APP_URL: z.url().default('http://localhost:3101'),
  ADMIN_URL: z.url().default('http://localhost:3102'),
  API_URL: z.url().default('http://localhost:4100'),
})

const apiSchema = baseSchema.extend({
  API_PORT: port.default(4100),

  DATABASE_URL: z.string().startsWith('postgresql://'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),

  REDIS_URL: z.string().startsWith('redis://'),

  SESSION_SECRET: notPlaceholder('SESSION_SECRET').min(32),
  SESSION_COOKIE_NAME: z.string().default('as_session'),
  ADMIN_SESSION_COOKIE_NAME: z.string().default('as_admin_session'),
  SESSION_COOKIE_DOMAIN: z.string().default('localhost'),
  SESSION_ABSOLUTE_LIFETIME_DAYS: z.coerce.number().int().default(30),
  SESSION_IDLE_TIMEOUT_DAYS: z.coerce.number().int().default(14),
  IP_HASH_SALT: notPlaceholder('IP_HASH_SALT').min(16),

  ARGON2_MEMORY_COST: z.coerce.number().int().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().default(1),

  RATE_LIMIT_ENABLED: bool.default(true),

  MAIL_TRANSPORT: z.enum(['resend', 'smtp', 'memory']).default('smtp'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: port.default(51025),
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  MAIL_FROM_NAME: z.string().default('AutoServices'),
  MAIL_FROM_EMAIL: z.email().default('notifications@example.com'),
  MAIL_REPLY_TO: z.email().optional(),

  S3_ENDPOINT: z.url().default('http://localhost:59000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('autoservices'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),

  DEFAULT_CURRENCY: z.string().length(3).default('GBP'),
  DEFAULT_DISTANCE_UNIT: z.enum(['MILES', 'KILOMETERS']).default('MILES'),
  DEFAULT_TIMEZONE: z.string().default('Europe/London'),
  DEFAULT_LOCALE: z.string().default('en-GB'),

  OPENAPI_ENABLED: bool.default(true),

  /**
   * DEVELOPMENT-ONLY auth shortcut. Guarded three ways (see auth module):
   * this flag, NODE_ENV !== 'production', and a hard throw at bootstrap.
   * It cannot be switched on in production by configuration alone.
   */
  DEV_AUTH_ENABLED: bool.default(false),
})

export type ApiConfig = z.infer<typeof apiSchema> & { isProduction: boolean; isTest: boolean }

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatIssues(parsed.error)}\n\n` +
        `Copy .env.example to .env and fill in the required values.`,
    )
  }
  const cfg = parsed.data

  // Production must never run with the dev auth shortcut or a real-mail misconfiguration.
  if (cfg.NODE_ENV === 'production') {
    if (cfg.DEV_AUTH_ENABLED) {
      throw new Error('DEV_AUTH_ENABLED must be false in production.')
    }
    if (cfg.MAIL_TRANSPORT === 'resend' && !cfg.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is required when MAIL_TRANSPORT=resend.')
    }
  }

  return { ...cfg, isProduction: cfg.NODE_ENV === 'production', isTest: cfg.NODE_ENV === 'test' }
}

/** Keys whose values must never be printed. */
const SECRET_KEYS = new Set([
  'SESSION_SECRET',
  'IP_HASH_SALT',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'S3_SECRET_KEY',
  'DATABASE_URL',
  'CSRF_SECRET',
])

/** Safe-to-log projection of the config. */
export function redactConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [k, SECRET_KEYS.has(k) ? '[redacted]' : v]),
  )
}
