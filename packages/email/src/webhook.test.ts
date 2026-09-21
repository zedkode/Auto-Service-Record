import { describe, expect, it } from 'vitest'
import {
  verifyResendSignature,
  signResendWebhook,
  providerMessageIdOf,
  REPLAY_TOLERANCE_SECONDS,
} from './webhook.js'

const SECRET = 'whsec_' + Buffer.from('a-test-signing-secret-value').toString('base64')
const BODY = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_123' } })
const NOW = new Date('2026-09-20T12:00:00Z')
const TS = Math.floor(NOW.getTime() / 1000)

describe('verifyResendSignature', () => {
  it('accepts a correctly signed payload', () => {
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: TS, secret: SECRET })
    expect(verifyResendSignature(BODY, headers, SECRET, NOW)).toEqual({ ok: true })
  })

  it('rejects a tampered body', () => {
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: TS, secret: SECRET })
    const tampered = JSON.stringify({ type: 'email.bounced', data: { email_id: 'msg_123' } })
    expect(verifyResendSignature(tampered, headers, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a signature made with a different secret', () => {
    const otherSecret = 'whsec_' + Buffer.from('a-different-secret-entirely').toString('base64')
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: TS, secret: otherSecret })
    expect(verifyResendSignature(BODY, headers, SECRET, NOW).ok).toBe(false)
  })

  it('rejects a replayed timestamp beyond the tolerance', () => {
    const old = TS - REPLAY_TOLERANCE_SECONDS - 1
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: old, secret: SECRET })
    expect(verifyResendSignature(BODY, headers, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })

  it('accepts a timestamp within the tolerance', () => {
    const recent = TS - (REPLAY_TOLERANCE_SECONDS - 10)
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: recent, secret: SECRET })
    expect(verifyResendSignature(BODY, headers, SECRET, NOW).ok).toBe(true)
  })

  it.each([
    ['svix-id', { 'svix-timestamp': String(TS), 'svix-signature': 'v1,x' }],
    ['svix-timestamp', { 'svix-id': 'evt_1', 'svix-signature': 'v1,x' }],
    ['svix-signature', { 'svix-id': 'evt_1', 'svix-timestamp': String(TS) }],
  ])('rejects a payload missing %s', (_l, headers) => {
    expect(verifyResendSignature(BODY, headers, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'missing_headers',
    })
  })

  it('refuses to verify when no secret is configured', () => {
    const headers = signResendWebhook(BODY, { id: 'evt_1', timestamp: TS, secret: SECRET })
    // Never silently accept because verification is unconfigured.
    expect(verifyResendSignature(BODY, headers, '', NOW)).toEqual({
      ok: false,
      reason: 'no_secret',
    })
  })

  it('supports multiple signatures for secret rotation', () => {
    const valid = signResendWebhook(BODY, { id: 'evt_1', timestamp: TS, secret: SECRET })
    const combined = {
      ...valid,
      'svix-signature': `v1,aW52YWxpZA== ${valid['svix-signature']}`,
    }
    expect(verifyResendSignature(BODY, combined, SECRET, NOW).ok).toBe(true)
  })

  it('is insensitive to a signature of the wrong length', () => {
    const headers = { 'svix-id': 'e', 'svix-timestamp': String(TS), 'svix-signature': 'v1,short' }
    expect(verifyResendSignature(BODY, headers, SECRET, NOW).ok).toBe(false)
  })
})

describe('providerMessageIdOf', () => {
  it('reads email_id', () => {
    expect(providerMessageIdOf({ type: 'email.sent', data: { email_id: 'msg_9' } })).toBe('msg_9')
  })
  it('returns null when absent', () => {
    expect(providerMessageIdOf({ type: 'email.sent', data: {} })).toBeNull()
    expect(providerMessageIdOf({ type: 'email.sent' })).toBeNull()
  })
})
