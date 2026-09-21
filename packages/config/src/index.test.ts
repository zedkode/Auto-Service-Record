import { describe, it, expect } from 'vitest'
import { loadApiConfig, redactConfig } from './index.js'

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(48),
  IP_HASH_SALT: 'b'.repeat(32),
}

describe('loadApiConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const cfg = loadApiConfig(valid as never)
    expect(cfg.API_PORT).toBe(4100)
    expect(cfg.DEFAULT_DISTANCE_UNIT).toBe('MILES')
    expect(cfg.isProduction).toBe(false)
  })

  it('throws when a required variable is missing', () => {
    expect(() => loadApiConfig({ ...valid, DATABASE_URL: undefined } as never)).toThrow(
      /Invalid environment configuration/,
    )
  })

  it('rejects a placeholder secret left over from .env.example', () => {
    expect(() =>
      loadApiConfig({ ...valid, SESSION_SECRET: 'CHANGE_ME_generate_with_openssl' } as never),
    ).toThrow(/placeholder/)
  })

  it('rejects a session secret that is too short', () => {
    expect(() => loadApiConfig({ ...valid, SESSION_SECRET: 'short' } as never)).toThrow()
  })

  it('refuses DEV_AUTH_ENABLED in production', () => {
    expect(() =>
      loadApiConfig({ ...valid, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true' } as never),
    ).toThrow(/DEV_AUTH_ENABLED must be false in production/)
  })

  it('requires a Resend key when the resend transport is selected in production', () => {
    expect(() =>
      loadApiConfig({ ...valid, NODE_ENV: 'production', MAIL_TRANSPORT: 'resend' } as never),
    ).toThrow(/RESEND_API_KEY is required/)
  })
})

describe('redactConfig', () => {
  it('redacts every secret-bearing key', () => {
    const out = redactConfig({ SESSION_SECRET: 'super-secret', API_PORT: 4100 })
    expect(out.SESSION_SECRET).toBe('[redacted]')
    expect(out.API_PORT).toBe(4100)
  })
})
