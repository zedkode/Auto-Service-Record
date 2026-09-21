/**
 * Session and verification tokens.
 *
 * The plaintext token exists only in the cookie or the email we sent. Only its SHA-256
 * hash is stored, so a database leak yields nothing usable (SECURITY.md §4, §5).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * IP addresses are stored salted-hashed: enough to spot anomalies, not enough to build
 * a location history (SECURITY.md §12, DATABASE.md §4.1).
 */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

export interface TokenPair {
  token: string
  tokenHash: string
}

export function createTokenPair(bytes = 32): TokenPair {
  const token = generateToken(bytes)
  return { token, tokenHash: hashToken(token) }
}

export function expiresIn(seconds: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + seconds * 1000)
}

export const SESSION_ABSOLUTE_LIFETIME_S = 30 * 24 * 60 * 60
export const EMAIL_VERIFICATION_LIFETIME_S = 24 * 60 * 60
export const PASSWORD_RESET_LIFETIME_S = 60 * 60
