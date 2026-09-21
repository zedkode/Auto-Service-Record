/**
 * Verification and password-reset integration tests (AUTH-002, AUTH-004).
 *
 * These assert the security properties, not just the happy path: tokens are stored
 * hashed, single-use, expiring; reset revokes every session; and the forgot-password
 * response is identical for known and unknown addresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
process.env.RATE_LIMIT_ENABLED = 'false' // exercised separately; would mask assertions here

const { createApp } = await import('../../src/bootstrap.js')
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { hashToken } = await import('@autoservices/auth')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>
const emails: string[] = []

const post = (p: string, body: unknown, cookie?: string) =>
  fetch(`${baseUrl}/api/v1${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })

function freshEmail(tag: string) {
  const e = `authflow-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  emails.push(e)
  return e
}

async function register(email: string, password = 'a-properly-long-password') {
  const res = await post('/auth/register', {
    email,
    password,
    passwordConfirmation: password,
    displayName: 'Flow Test',
    acceptTerms: true,
  })
  expect(res.status).toBe(201)
  return res
}

/** Reads the token straight from the DB by matching its hash — the plaintext never persists. */
async function currentVerificationToken(userId: string) {
  return prisma.emailVerificationToken.findFirst({
    where: { userId, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
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
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) continue
    const ws = await prisma.workspace.findMany({ where: { ownerUserId: user.id } })
    for (const w of ws) {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: w.id } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: w.id } })
      await prisma.workspace.delete({ where: { id: w.id } })
    }
    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } })
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
    await prisma.session.deleteMany({ where: { userId: user.id } })
    await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } })
    await prisma.userProfile.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
  await prisma.$disconnect()
  await app.close()
})

describe('email verification', () => {
  it('registers unverified and issues a token stored only as a hash', async () => {
    const email = freshEmail('verify')
    await register(email)

    const user = await prisma.user.findUnique({ where: { email } })
    expect(user?.emailVerifiedAt).toBeNull()
    expect(user?.status).toBe('PENDING_VERIFICATION')

    const token = await currentVerificationToken(user!.id)
    expect(token).not.toBeNull()
    // 64 hex chars == SHA-256. If a plaintext token were stored it would be base64url.
    expect(token!.tokenHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('verifies with a valid token and promotes the account to ACTIVE', async () => {
    const email = freshEmail('ok')
    await register(email)
    const user = await prisma.user.findUnique({ where: { email } })

    // Reconstruct the plaintext the way the email did: we cannot, by design — so drive
    // the service through a token we create ourselves and hash identically.
    const plaintext = 'test-token-' + Math.random().toString(36).slice(2)
    await prisma.emailVerificationToken.create({
      data: {
        userId: user!.id,
        tokenHash: hashToken(plaintext),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    const res = await post('/auth/verify-email', { token: plaintext })
    expect(res.status).toBe(200)
    expect((await res.json()).data.alreadyVerified).toBe(false)

    const after = await prisma.user.findUnique({ where: { email } })
    expect(after?.emailVerifiedAt).not.toBeNull()
    expect(after?.status).toBe('ACTIVE')
  })

  it('rejects a reused token', async () => {
    const email = freshEmail('reuse')
    await register(email)
    const user = await prisma.user.findUnique({ where: { email } })
    const plaintext = 'reuse-' + Math.random().toString(36).slice(2)
    await prisma.emailVerificationToken.create({
      data: {
        userId: user!.id,
        tokenHash: hashToken(plaintext),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    expect((await post('/auth/verify-email', { token: plaintext })).status).toBe(200)
    const replay = await post('/auth/verify-email', { token: plaintext })
    expect(replay.status).toBe(400)
    expect((await replay.json()).error.code).toBe('TOKEN_INVALID')
  })

  it('rejects an expired token', async () => {
    const email = freshEmail('expired')
    await register(email)
    const user = await prisma.user.findUnique({ where: { email } })
    const plaintext = 'expired-' + Math.random().toString(36).slice(2)
    await prisma.emailVerificationToken.create({
      data: {
        userId: user!.id,
        tokenHash: hashToken(plaintext),
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const res = await post('/auth/verify-email', { token: plaintext })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('TOKEN_INVALID')
  })

  it('rejects a forged token with the same message as an expired one', async () => {
    const res = await post('/auth/verify-email', { token: 'totally-made-up-token-value' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('TOKEN_INVALID')
  })
})

describe('password reset', () => {
  it('returns an identical response for known and unknown addresses', async () => {
    const email = freshEmail('known')
    await register(email)

    const known = await post('/auth/forgot-password', { email })
    const unknown = await post('/auth/forgot-password', { email: 'nobody-here@example.com' })

    expect(known.status).toBe(unknown.status)
    expect(await known.json()).toEqual(await unknown.json())
  })

  it('resets the password, revokes every session, and burns the token', async () => {
    const email = freshEmail('reset')
    await register(email)
    const user = await prisma.user.findUnique({ where: { email } })

    // Registration opened a session; it must not survive the reset.
    const sessionsBefore = await prisma.session.count({
      where: { userId: user!.id, revokedAt: null },
    })
    expect(sessionsBefore).toBeGreaterThan(0)

    const plaintext = 'reset-' + Math.random().toString(36).slice(2)
    await prisma.passwordResetToken.create({
      data: {
        userId: user!.id,
        tokenHash: hashToken(plaintext),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    const res = await post('/auth/reset-password', {
      token: plaintext,
      password: 'a-completely-new-password',
      passwordConfirmation: 'a-completely-new-password',
    })
    expect(res.status).toBe(200)

    expect(await prisma.session.count({ where: { userId: user!.id, revokedAt: null } })).toBe(0)

    expect(
      (await post('/auth/login', { email, password: 'a-properly-long-password' })).status,
    ).toBe(401)
    expect(
      (await post('/auth/login', { email, password: 'a-completely-new-password' })).status,
    ).toBe(200)

    const replay = await post('/auth/reset-password', {
      token: plaintext,
      password: 'yet-another-password-x',
      passwordConfirmation: 'yet-another-password-x',
    })
    expect(replay.status).toBe(400)
  })

  it('requires the confirmation to match', async () => {
    const res = await post('/auth/reset-password', {
      token: 'whatever-token-value',
      password: 'a-properly-long-password',
      passwordConfirmation: 'something-else-entirely',
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(
      body.error.details.some((d: { field: string }) => d.field === 'passwordConfirmation'),
    ).toBe(true)
  })

  it('issuing a new reset token invalidates the previous one', async () => {
    const email = freshEmail('rotate')
    await register(email)
    const user = await prisma.user.findUnique({ where: { email } })

    const first = 'first-' + Math.random().toString(36).slice(2)
    await prisma.passwordResetToken.create({
      data: {
        userId: user!.id,
        tokenHash: hashToken(first),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    // Requesting again rotates the token.
    await post('/auth/forgot-password', { email })

    const res = await post('/auth/reset-password', {
      token: first,
      password: 'should-not-work-here',
      passwordConfirmation: 'should-not-work-here',
    })
    expect(res.status).toBe(400)
  })
})
