import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, verifyPasswordTimingSafe, needsRehash } from './password.js'
import { createTokenPair, hashToken, hashIp, safeEqual } from './tokens.js'

describe('password hashing', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword(hash, 'wrong')).toBe(false)
  })

  it('produces a different hash for the same password (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false)
  })

  it('still performs a verification for an unknown user', async () => {
    // The point is that it does not short-circuit; it must resolve false, not throw.
    expect(await verifyPasswordTimingSafe(null, 'anything')).toBe(false)
  })

  it('flags a hash made with weaker parameters for upgrade', async () => {
    const weak = await hashPassword('x', { memoryCost: 512, timeCost: 1, parallelism: 1 })
    expect(needsRehash(weak, { memoryCost: 19456, timeCost: 2, parallelism: 1 })).toBe(true)
  })
})

describe('tokens', () => {
  it('stores only a hash, never the plaintext', () => {
    const { token, tokenHash } = createTokenPair()
    expect(tokenHash).toHaveLength(64)
    expect(tokenHash).not.toContain(token)
    expect(hashToken(token)).toBe(tokenHash)
  })

  it('generates unique tokens', () => {
    const seen = new Set(Array.from({ length: 200 }, () => createTokenPair().token))
    expect(seen.size).toBe(200)
  })

  it('hashes IPs with a salt', () => {
    expect(hashIp('1.2.3.4', 'salt-a')).not.toBe(hashIp('1.2.3.4', 'salt-b'))
    expect(hashIp('1.2.3.4', 'salt-a')).toBe(hashIp('1.2.3.4', 'salt-a'))
  })

  it('compares in constant time without throwing on length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
