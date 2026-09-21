import { describe, expect, it } from 'vitest'
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
} from './totp.js'

/**
 * RFC 6238 Appendix B publishes vectors for the SHA-1 variant with the ASCII secret
 * "12345678901234567890". Matching them is what proves this implementation is a real
 * TOTP rather than something that merely looks like one.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

describe('RFC 6238 test vectors', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at t=%i produces %s', (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, { digits: 8 })).toBe(expected)
  })
})

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world']) {
      const bytes = Buffer.from(input, 'ascii')
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true)
    }
  })

  it('matches known RFC 4648 encodings', () => {
    expect(base32Encode(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI')
    expect(base32Decode('MZXW6YTBOI').toString('ascii')).toBe('foobar')
  })

  it('tolerates lowercase, padding and whitespace from a pasted secret', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString('ascii')).toBe('foobar')
  })

  it('rejects a secret containing characters base32 cannot hold', () => {
    expect(() => base32Decode('MZXW6YTB01')).toThrow()
  })
})

describe('verifyTotp', () => {
  const secret = generateTotpSecret()
  const now = 1_700_000_000_000

  it('accepts the current code', () => {
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true)
  })

  it('accepts one step of drift either side', () => {
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true)
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true)
  })

  it('REFUSES two steps away — the window is deliberately narrow', () => {
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false)
    expect(verifyTotp(secret, totpCode(secret, now + 90_000), now)).toBe(false)
  })

  it('refuses a code from a different secret', () => {
    expect(verifyTotp(secret, totpCode(generateTotpSecret(), now), now)).toBe(false)
  })

  it('refuses malformed input without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78', 'null']) {
      expect(verifyTotp(secret, bad, now)).toBe(false)
    }
  })

  it('tolerates spaces in a code the user pasted', () => {
    const code = totpCode(secret, now)
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true)
  })

  it('produces a six-digit code, zero-padded', () => {
    for (let i = 0; i < 200; i++) {
      expect(totpCode(secret, now + i * 30_000)).toMatch(/^\d{6}$/)
    }
  })
})

describe('generateTotpSecret', () => {
  it('returns 32 base32 characters (160 bits) and differs every time', () => {
    const a = generateTotpSecret()
    const b = generateTotpSecret()
    expect(a).toMatch(/^[A-Z2-7]{32}$/)
    expect(a).not.toBe(b)
  })
})

describe('totpUri', () => {
  it('is scannable and names the issuer', () => {
    const uri = totpUri({ secret: 'ABCDEF', account: 'admin@example.com', issuer: 'AutoServices' })
    expect(uri).toContain('otpauth://totp/AutoServices%3Aadmin%40example.com')
    expect(uri).toContain('secret=ABCDEF')
    expect(uri).toContain('issuer=AutoServices')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })
})
