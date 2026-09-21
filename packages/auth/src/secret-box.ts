/**
 * Authenticated encryption for secrets that must be recoverable.
 *
 * Almost everything in this platform is hashed rather than encrypted — passwords, session
 * tokens, reset tokens — because it only ever needs to be *compared*. A TOTP secret is
 * different: verifying a rotating code requires the original bytes, so it has to be
 * reversible. That makes it one of the few things worth encrypting, and worth encrypting
 * properly (DECISIONS.md D-064).
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead of decrypting
 * to plausible rubbish.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const VERSION = 'v1'

/**
 * Derives a 256-bit key from the application secret rather than using it raw: the same
 * secret protects other things, and HKDF with a distinct `info` keeps those uses from
 * sharing key material.
 */
function keyFrom(secret: string): Buffer {
  if (!secret || secret.length < 32) {
    throw new Error('Encryption secret must be at least 32 characters.')
  }
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), 'autoservices:mfa:v1', 32),
  )
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function sealSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFrom(secret), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
}

/** Throws if the value was tampered with, truncated, or sealed under another key. */
export function openSecret(sealed: string, secret: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised sealed secret format.')
  }
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const data = Buffer.from(parts[3]!, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Sealed secret is malformed.')
  }
  const decipher = createDecipheriv(ALGORITHM, keyFrom(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
