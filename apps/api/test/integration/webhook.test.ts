/**
 * SEC-013 — Resend webhook integration tests.
 *
 * These assert the SECURITY properties, not just the happy path: forged and replayed
 * requests are refused, and a provider that delivers events out of order cannot corrupt
 * our delivery state.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
process.env.RATE_LIMIT_ENABLED = 'false'

const SECRET =
  process.env.RESEND_WEBHOOK_SECRET ||
  'whsec_' + Buffer.from('test-webhook-secret-value').toString('base64')
process.env.RESEND_WEBHOOK_SECRET = SECRET

const { createApp } = await import('../../src/bootstrap.js')
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { signResendWebhook } = await import('@autoservices/email')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>
const createdMessageIds: string[] = []

function post(body: unknown, opts: { id?: string; timestamp?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body)
  const headers = signResendWebhook(raw, {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000),
    secret: opts.secret ?? SECRET,
  })
  return fetch(`${baseUrl}/api/v1/webhooks/resend`, {
    method: 'POST',
    headers: { ...(headers as Record<string, string>), 'content-type': 'application/json' },
    body: raw,
  })
}

async function seedMessage(providerMessageId: string, status = 'SENT') {
  const m = await prisma.emailMessage.create({
    data: {
      idempotencyKey: `wh-test-${Math.random().toString(36).slice(2)}`,
      template: 'service-due',
      recipientEmail: 'webhook-test@example.com',
      subject: 'Webhook test',
      provider: 'test',
      providerMessageId,
      status: status as never,
    },
  })
  createdMessageIds.push(m.id)
  return m
}

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3101'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()
})

afterAll(async () => {
  await prisma.emailDeliveryEvent.deleteMany({
    where: { emailMessageId: { in: createdMessageIds } },
  })
  await prisma.emailMessage.deleteMany({ where: { id: { in: createdMessageIds } } })
  await prisma.auditLog.deleteMany({ where: { resourceType: 'email_webhook' } })
  await prisma.emailSuppression.deleteMany({
    where: { email: { in: ['webhook-test@example.com', 'bouncer@example.com'] } },
  })
  await prisma.$disconnect()
  await app.close()
})

describe('signature verification', () => {
  it('rejects a request with no signature headers', async () => {
    const res = await fetch(`${baseUrl}/api/v1/webhooks/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.delivered' }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a signature made with a different secret', async () => {
    const m = await seedMessage(`msg_wrongsecret_${Date.now()}`)
    const res = await post(
      { type: 'email.delivered', data: { email_id: m.providerMessageId } },
      { secret: 'whsec_' + Buffer.from('a-different-secret-entirely').toString('base64') },
    )
    expect(res.status).toBe(401)
  })

  it('rejects a body that was tampered with after signing', async () => {
    const m = await seedMessage(`msg_tampered_${Date.now()}`)
    const original = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: m.providerMessageId },
    })
    const headers = signResendWebhook(original, {
      id: 'evt_tamper',
      timestamp: Math.floor(Date.now() / 1000),
      secret: SECRET,
    })
    const res = await fetch(`${baseUrl}/api/v1/webhooks/resend`, {
      method: 'POST',
      headers: { ...(headers as Record<string, string>), 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email.bounced', data: { email_id: m.providerMessageId } }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects a replayed timestamp outside the tolerance window', async () => {
    const m = await seedMessage(`msg_stale_${Date.now()}`)
    const res = await post(
      { type: 'email.delivered', data: { email_id: m.providerMessageId } },
      { timestamp: Math.floor(Date.now() / 1000) - 3600 },
    )
    expect(res.status).toBe(401)
  })

  it('accepts a correctly signed request', async () => {
    const m = await seedMessage(`msg_valid_${Date.now()}`)
    const res = await post({ type: 'email.delivered', data: { email_id: m.providerMessageId } })
    expect(res.status).toBe(200)
    expect((await res.json()).data.processed).toBe(true)
  })
})

describe('event processing', () => {
  it('advances the status and stamps deliveredAt', async () => {
    const m = await seedMessage(`msg_adv_${Date.now()}`)
    await post({ type: 'email.delivered', data: { email_id: m.providerMessageId } })

    const after = await prisma.emailMessage.findUnique({ where: { id: m.id } })
    expect(after?.status).toBe('DELIVERED')
    expect(after?.deliveredAt).not.toBeNull()
  })

  it('treats a replayed event id as a no-op', async () => {
    const m = await seedMessage(`msg_replay_${Date.now()}`)
    const eventId = `evt_replay_${Date.now()}`

    const first = await post(
      { type: 'email.delivered', data: { email_id: m.providerMessageId } },
      { id: eventId },
    )
    expect((await first.json()).data.processed).toBe(true)

    const second = await post(
      { type: 'email.delivered', data: { email_id: m.providerMessageId } },
      { id: eventId },
    )
    expect((await second.json()).data).toEqual({ processed: false, reason: 'duplicate' })

    expect(await prisma.emailDeliveryEvent.count({ where: { emailMessageId: m.id } })).toBe(1)
  })

  it('NEVER regresses status on an out-of-order event', async () => {
    const m = await seedMessage(`msg_order_${Date.now()}`)
    await post({ type: 'email.delivered', data: { email_id: m.providerMessageId } })

    // Providers deliver out of order; a late "sent" must not undo "delivered".
    const late = await post({ type: 'email.sent', data: { email_id: m.providerMessageId } })
    expect((await late.json()).data.advanced).toBe(false)

    const after = await prisma.emailMessage.findUnique({ where: { id: m.id } })
    expect(after?.status).toBe('DELIVERED')
    // The event is still recorded, just not acted on.
    expect(await prisma.emailDeliveryEvent.count({ where: { emailMessageId: m.id } })).toBe(2)
  })

  it('lets a bounce outrank a delivery', async () => {
    const m = await seedMessage(`msg_bounce_${Date.now()}`)
    await post({ type: 'email.delivered', data: { email_id: m.providerMessageId } })
    await post({ type: 'email.bounced', data: { email_id: m.providerMessageId } })

    const after = await prisma.emailMessage.findUnique({ where: { id: m.id } })
    expect(after?.status).toBe('BOUNCED')
  })

  it('records engagement events without moving the delivery status', async () => {
    const m = await seedMessage(`msg_open_${Date.now()}`)
    await post({ type: 'email.delivered', data: { email_id: m.providerMessageId } })
    const opened = await post({ type: 'email.opened', data: { email_id: m.providerMessageId } })

    expect((await opened.json()).data.advanced).toBe(false)
    const after = await prisma.emailMessage.findUnique({ where: { id: m.id } })
    expect(after?.status).toBe('DELIVERED')
  })

  it('does not fail on an event for an unknown message', async () => {
    const res = await post({ type: 'email.delivered', data: { email_id: 'msg_unknown_xyz' } })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ processed: false, reason: 'unknown_message' })
  })
})

describe('suppression list (MAIL-005)', () => {
  async function seedFor(email: string, providerMessageId: string) {
    const m = await prisma.emailMessage.create({
      data: {
        idempotencyKey: `sup-test-${Math.random().toString(36).slice(2)}`,
        template: 'service-due',
        recipientEmail: email,
        subject: 'Suppression test',
        provider: 'test',
        providerMessageId,
        status: 'SENT' as never,
      },
    })
    createdMessageIds.push(m.id)
    return m
  }

  it('adds the address on a permanent bounce', async () => {
    const id = `msg_sup_${Math.random().toString(36).slice(2)}`
    await seedFor('bouncer@example.com', id)
    const res = await post({
      type: 'email.bounced',
      data: { email_id: id, bounce: { type: 'Permanent', subType: 'NoEmail' } },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.suppressed).toBe(true)

    const row = await prisma.emailSuppression.findFirst({
      where: { email: 'bouncer@example.com' },
    })
    expect(row?.reason).toBe('HARD_BOUNCE')
    expect(row?.releasedAt).toBeNull()
  })

  it('does NOT suppress on a transient bounce', async () => {
    await prisma.emailSuppression.deleteMany({ where: { email: 'webhook-test@example.com' } })
    const id = `msg_soft_${Math.random().toString(36).slice(2)}`
    await seedMessage(id)
    const res = await post({
      type: 'email.bounced',
      data: { email_id: id, bounce: { type: 'Transient', subType: 'MailboxFull' } },
    })
    expect((await res.json()).data.suppressed).toBe(false)
    expect(
      await prisma.emailSuppression.findFirst({ where: { email: 'webhook-test@example.com' } }),
    ).toBeNull()
  })

  it('matches the address case-insensitively', async () => {
    // citext: a bounce for Bouncer@Example.com must block bouncer@example.com.
    const row = await prisma.emailSuppression.findFirst({
      where: { email: 'BOUNCER@EXAMPLE.COM' },
    })
    expect(row).not.toBeNull()
  })

  it('re-suppresses an address that was released and bounced again', async () => {
    await prisma.emailSuppression.updateMany({
      where: { email: 'bouncer@example.com' },
      data: { releasedAt: new Date(), releasedBy: 'test' },
    })
    const id = `msg_resup_${Math.random().toString(36).slice(2)}`
    await seedFor('bouncer@example.com', id)
    await post({
      type: 'email.complained',
      data: { email_id: id },
    })
    const row = await prisma.emailSuppression.findFirst({
      where: { email: 'bouncer@example.com' },
    })
    // One manual release must not permanently disarm the protection.
    expect(row?.releasedAt).toBeNull()
    expect(row?.reason).toBe('COMPLAINT')
  })
})
