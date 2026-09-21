/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), implemented directly on node's crypto.
 *
 * Deliberately not a dependency: the algorithm is forty lines, the RFC publishes test
 * vectors to prove an implementation correct, and this is the second factor protecting
 * every administrative action on the platform.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOTP_DIGITS = 6
export const TOTP_PERIOD_SECONDS = 30
/**
 * One step either side. Enough for ordinary clock drift; more would widen the window an
 * intercepted code stays usable in.
 */
export const TOTP_WINDOW = 1

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, which is what every authenticator app expects. */
export function base32Encode(buffer: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret.')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** 20 random bytes — the RFC 4226 recommended secret length. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** HOTP: the truncated HMAC of a counter (RFC 4226 §5.3). */
function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8)
  // Counter is a 64-bit big-endian integer; JavaScript numbers are safe well past any
  // plausible time step, but the high word still has to be written.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buf.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', secret).update(buf).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

export function totpCode(
  secret: string,
  atMs: number = Date.now(),
  options: { period?: number; digits?: number } = {},
): string {
  const period = options.period ?? TOTP_PERIOD_SECONDS
  const counter = Math.floor(atMs / 1000 / period)
  return hotp(base32Decode(secret), counter, options.digits ?? TOTP_DIGITS)
}

/**
 * Verifies a submitted code, allowing `window` steps of drift either side.
 *
 * Compared in constant time: a timing oracle on a six-digit code is a short search.
 */
export function verifyTotp(
  secret: string,
  code: string,
  atMs: number = Date.now(),
  options: { window?: number; period?: number; digits?: number } = {},
): boolean {
  const digits = options.digits ?? TOTP_DIGITS
  const submitted = code.replace(/\s/g, '')
  if (!new RegExp(`^\\d{${digits}}$`).test(submitted)) return false

  const period = options.period ?? TOTP_PERIOD_SECONDS
  const window = options.window ?? TOTP_WINDOW
  const key = base32Decode(secret)
  const counter = Math.floor(atMs / 1000 / period)

  let matched = false
  for (let drift = -window; drift <= window; drift++) {
    const expected = hotp(key, counter + drift, digits)
    // No early exit: comparing every candidate keeps the work constant regardless of
    // which step matched.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) matched = true
  }
  return matched
}

/**
 * The `otpauth://` URI an authenticator app scans. The secret is in it, so it is shown
 * once at enrolment and never stored or logged.
 */
export function totpUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`)
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
