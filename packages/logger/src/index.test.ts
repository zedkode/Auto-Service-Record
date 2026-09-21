import { describe, it, expect } from 'vitest'
import { sanitiseMetadata, withLogContext, getLogContext } from './index.js'

describe('sanitiseMetadata', () => {
  it('redacts sensitive keys at the top level', () => {
    expect(sanitiseMetadata({ password: 'hunter2', email: 'a@example.com' })).toEqual({
      password: '[redacted]',
      email: 'a@example.com',
    })
  })

  it('redacts sensitive keys when nested', () => {
    const out = sanitiseMetadata({ user: { profile: { sessionToken: 'abc' } } }) as any
    expect(out.user.profile.sessionToken).toBe('[redacted]')
  })

  it('redacts adversarial key names regardless of case or separator', () => {
    const out = sanitiseMetadata({
      user_password_confirmation: 'x',
      API_KEY: 'y',
      'api-key': 'y2',
      apiKey: 'y3',
      refreshToken: 'z',
      SESSION_ID: 's',
      privateKey: 'p',
      'x-signature': 'sig',
    }) as any
    for (const k of Object.keys(out)) {
      expect(out[k]).toBe('[redacted]')
    }
  })

  it('leaves ordinary keys alone', () => {
    const out = sanitiseMetadata({
      vehicleId: 'v1',
      manufacturer: 'Ford',
      odometer: 131260,
    }) as any
    expect(out.vehicleId).toBe('v1')
    expect(out.manufacturer).toBe('Ford')
    expect(out.odometer).toBe(131260)
  })

  it('walks arrays', () => {
    const out = sanitiseMetadata([{ token: 'a' }, { safe: 'b' }]) as any[]
    expect(out[0].token).toBe('[redacted]')
    expect(out[1].safe).toBe('b')
  })

  it('stops at excessive depth rather than recursing forever', () => {
    const deep: any = {}
    let node = deep
    for (let i = 0; i < 20; i++) {
      node.child = {}
      node = node.child
    }
    expect(() => sanitiseMetadata(deep)).not.toThrow()
  })
})

describe('log context', () => {
  it('propagates across async boundaries', async () => {
    await withLogContext({ correlationId: 'corr-1' }, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(getLogContext().correlationId).toBe('corr-1')
    })
  })

  it('merges nested contexts', () => {
    withLogContext({ correlationId: 'c' }, () => {
      withLogContext({ userId: 'u' }, () => {
        expect(getLogContext()).toEqual({ correlationId: 'c', userId: 'u' })
      })
    })
  })
})
