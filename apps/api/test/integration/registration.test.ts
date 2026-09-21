/**
 * Registration integration tests.
 *
 * REGRESSION: workspace slugs were derived from `user.id.slice(0, 8)`. Because ids are
 * UUIDv7 and time-ordered, two users registering in the same window produced the same
 * slug and the second signup failed with a 500. These tests register users back to back,
 * which is exactly the case the old implementation got wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
// This suite deliberately registers a burst of users to prove the slug fix. Rate
// limiting is exercised separately in the auth verification script.
process.env.RATE_LIMIT_ENABLED = 'false'

const { createApp } = await import('../../src/bootstrap.js')
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>
const createdEmails: string[] = []

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
  for (const email of createdEmails) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) continue
    const ws = await prisma.workspace.findMany({ where: { ownerUserId: user.id } })
    for (const w of ws) {
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: w.id } })
      await prisma.auditLog.deleteMany({ where: { workspaceId: w.id } })
      await prisma.workspace.delete({ where: { id: w.id } })
    }
    await prisma.session.deleteMany({ where: { userId: user.id } })
    await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } })
    await prisma.userProfile.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
  await prisma.$disconnect()
  await app.close()
})

const post = (path: string, body: unknown) =>
  fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Registration now requires password confirmation and explicit terms acceptance. */
const register = (email: string, displayName: string, password = 'a-properly-long-password') =>
  post('/auth/register', {
    email,
    password,
    passwordConfirmation: password,
    displayName,
    acceptTerms: true,
  })

function freshEmail(tag: string): string {
  const email = `reg-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  createdEmails.push(email)
  return email
}

describe('POST /auth/register', () => {
  it('creates user, profile, workspace and OWNER membership in one transaction', async () => {
    const email = freshEmail('basic')
    const res = await register(email, 'Basic')
    expect(res.status).toBe(201)

    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true, memberships: true, ownedWorkspaces: true },
    })
    expect(user?.profile?.displayName).toBe('Basic')
    expect(user?.ownedWorkspaces).toHaveLength(1)
    expect(user?.memberships[0]?.role).toBe('OWNER')
    expect(user?.memberships[0]?.status).toBe('ACTIVE')
  })

  it('sets a session cookie on success', async () => {
    const res = await register(freshEmail('cookie'), 'Cookie')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('as_session=')
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
  })

  it('REGRESSION: several users registering back to back all succeed', async () => {
    // The previous implementation failed here from the second user onwards.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => register(freshEmail(`burst${i}`), `Burst ${i}`)),
    )
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
  })

  it('allocates a unique slug to every workspace', async () => {
    const slugs = await prisma.workspace.findMany({ select: { slug: true } })
    expect(new Set(slugs.map((s) => s.slug)).size).toBe(slugs.length)
  })

  it('rejects a duplicate email without revealing more than necessary', async () => {
    const email = freshEmail('dupe')
    expect((await register(email, 'A')).status).toBe(201)
    const second = await register(email, 'B')
    expect(second.status).toBe(409)
    expect((await second.json()).error.code).toBe('EMAIL_ALREADY_REGISTERED')
  })

  it('rejects a short password with a field-level error', async () => {
    const res = await post('/auth/register', {
      email: freshEmail('short'),
      password: 'short',
      passwordConfirmation: 'short',
      displayName: 'S',
      acceptTerms: true,
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(true)
  })

  it('never returns the password hash', async () => {
    const res = await register(freshEmail('nohash'), 'N')
    expect(JSON.stringify(await res.json())).not.toMatch(/argon2|passwordHash/i)
  })
})
