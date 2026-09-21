/**
 * SEC-009 — upload sessions are capped per workspace.
 *
 * Its own file because rate limiting has to be ON for the whole app, which would throttle
 * every other test that shares a process.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
process.env.DEV_AUTH_ENABLED = 'true'
process.env.RATE_LIMIT_ENABLED = 'true'

const { createApp } = await import('../../src/bootstrap.js')
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { hashPassword } = await import('@autoservices/auth')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>
let cookie: string
let workspaceId: string
const userIds: string[] = []
const workspaceIds: string[] = []

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3100'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()

  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const email = `rl-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('RateLimitTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Rate Limit' } },
    },
  })
  userIds.push(user.id)
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Rate limit garage',
      slug: `rl-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(workspace.id)
  workspaceId = workspace.id

  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0]!
}, 60_000)

afterAll(async () => {
  await prisma.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('upload sessions are capped per workspace', () => {
  it('starts refusing after the documented 60 per hour', async () => {
    const attempt = () =>
      fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/documents/upload-session`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'burst.pdf',
          contentType: 'application/pdf',
          byteSize: 10,
          checksumSha256: createHash('sha256').update('x').digest('hex'),
        }),
      })

    const statuses: number[] = []
    for (let i = 0; i < 65; i++) statuses.push((await attempt()).status)

    const limited = statuses.filter((s) => s === 429).length
    const accepted = statuses.filter((s) => s === 201).length
    expect(accepted).toBeLessThanOrEqual(60)
    expect(limited).toBeGreaterThan(0)

    // And the refusal tells the client when to come back.
    const last = await attempt()
    expect(last.status).toBe(429)
    expect(last.headers.get('retry-after')).toBe('3600')
  }, 120_000)
})
