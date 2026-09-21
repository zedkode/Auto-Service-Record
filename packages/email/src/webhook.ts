/**
 * Resend webhook signature verification (SEC-013, SECURITY.md §11, EMAILS.md §6).
 *
 * Resend signs with Svix. The signed payload is `${id}.${timestamp}.${rawBody}`, HMAC
 * SHA-256 with the base64 secret (after stripping its `whsec_` prefix), compared in
 * constant time. Timestamps older than the tolerance are rejected as replays.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const REPLAY_TOLERANCE_SECONDS = 5 * 60

export interface WebhookHeaders {
  'svix-id'?: string
  'svix-timestamp'?: string
  'svix-signature'?: string
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'stale_timestamp' | 'bad_signature' | 'no_secret' }

export function verifyResendSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secret: string,
  now: Date = new Date(),
): WebhookVerification {
  if (!secret) return { ok: false, reason: 'no_secret' }

  const id = headers['svix-id']
  const timestamp = headers['svix-timestamp']
  const signature = headers['svix-signature']
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'stale_timestamp' }
  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sentAt)
  if (ageSeconds > REPLAY_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp' }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64')

  // The header carries a space-separated list of `v1,<signature>` pairs so the secret
  // can be rotated; any one matching is sufficient.
  const candidates = signature
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter((v): v is string => Boolean(v))

  for (const candidate of candidates) {
    if (safeCompare(candidate, expected)) return { ok: true }
  }
  return { ok: false, reason: 'bad_signature' }
}

/** Builds a signature, for tests and local webhook simulation. */
export function signResendWebhook(
  rawBody: string,
  opts: { id: string; timestamp: number; secret: string },
): WebhookHeaders {
  const key = Buffer.from(opts.secret.replace(/^whsec_/, ''), 'base64')
  const sig = createHmac('sha256', key)
    .update(`${opts.id}.${opts.timestamp}.${rawBody}`)
    .digest('base64')
  return {
    'svix-id': opts.id,
    'svix-timestamp': String(opts.timestamp),
    'svix-signature': `v1,${sig}`,
  }
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export interface ResendWebhookEvent {
  type: string
  created_at?: string
  data?: {
    email_id?: string
    to?: string[] | string
    subject?: string
    [k: string]: unknown
  }
}

/** Extracts the provider message id, which Resend nests differently per event type. */
export function providerMessageIdOf(event: ResendWebhookEvent): string | null {
  const d = event.data ?? {}
  return (d.email_id as string) ?? (d.id as string) ?? null
}

export type SuppressionVerdict =
  | { suppress: true; reason: 'HARD_BOUNCE' | 'COMPLAINT'; detail: string }
  | { suppress: false; detail: string }

/**
 * Decides whether a delivery event should stop us ever writing to this address again.
 *
 * Deliberately conservative. Suppressing an address silently ends that owner's MOT,
 * insurance and service reminders, so an ambiguous bounce is NOT grounds to suppress:
 * a full mailbox or a greylisting blip is transient and clears by itself. Only a bounce
 * the provider calls permanent, or a spam complaint, is acted on.
 */
export function suppressionFromEvent(event: ResendWebhookEvent): SuppressionVerdict {
  if (event.type === 'email.complained') {
    return { suppress: true, reason: 'COMPLAINT', detail: 'recipient reported the message as spam' }
  }
  if (event.type !== 'email.bounced') {
    return { suppress: false, detail: 'not a bounce or complaint' }
  }

  const bounce = (event.data?.bounce ?? {}) as { type?: string; subType?: string; message?: string }
  const kind = String(bounce.type ?? '').toLowerCase()
  const subType = bounce.subType ? ` (${bounce.subType})` : ''

  if (kind === 'permanent' || kind === 'hardbounce' || kind === 'hard_bounce') {
    return {
      suppress: true,
      reason: 'HARD_BOUNCE',
      detail: bounce.message ?? `permanent bounce${subType}`,
    }
  }
  // Transient, Undetermined, or a payload with no classification at all.
  return {
    suppress: false,
    detail: kind
      ? `${kind} bounce${subType}, not suppressing`
      : 'unclassified bounce, not suppressing',
  }
}
