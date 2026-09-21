import { describe, expect, it } from 'vitest'
import { openSecret, sealSecret } from './secret-box.js'

const KEY = 'a-test-application-secret-at-least-32-chars'
const OTHER = 'a-different-application-secret-also-32-chars'

describe('sealSecret / openSecret', () => {
  it('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    expect(openSecret(sealSecret(secret, KEY), KEY)).toBe(secret)
  })

  it('produces a different ciphertext every time', () => {
    // A fresh IV per call, so identical secrets are not identifiable in the database.
    const a = sealSecret('same', KEY)
    const b = sealSecret('same', KEY)
    expect(a).not.toBe(b)
    expect(openSecret(a, KEY)).toBe(openSecret(b, KEY))
  })

  it('never contains the plaintext', () => {
    expect(sealSecret('JBSWY3DPEHPK3PXP', KEY)).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('REFUSES a ciphertext sealed under another key', () => {
    expect(() => openSecret(sealSecret('x', KEY), OTHER)).toThrow()
  })

  it('REFUSES a tampered ciphertext rather than returning rubbish', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', KEY)
    const parts = sealed.split('.')
    const flipped = Buffer.from(parts[3]!, 'base64url')
    flipped[0] ^= 0xff
    parts[3] = flipped.toString('base64url')
    expect(() => openSecret(parts.join('.'), KEY)).toThrow()
  })

  it('REFUSES a tampered authentication tag', () => {
    const parts = sealSecret('x', KEY).split('.')
    const tag = Buffer.from(parts[2]!, 'base64url')
    tag[0] ^= 0xff
    parts[2] = tag.toString('base64url')
    expect(() => openSecret(parts.join('.'), KEY)).toThrow()
  })

  it('refuses malformed input', () => {
    for (const bad of ['', 'nonsense', 'v1.a.b', 'v2.a.b.c']) {
      expect(() => openSecret(bad, KEY)).toThrow()
    }
  })

  it('refuses a weak application secret', () => {
    expect(() => sealSecret('x', 'too-short')).toThrow(/at least 32/)
  })

  it('handles unicode', () => {
    const s = 'sécret-üñïcode-🔐'
    expect(openSecret(sealSecret(s, KEY), KEY)).toBe(s)
  })
})
