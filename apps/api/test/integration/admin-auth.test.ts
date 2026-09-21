/**
 * ADMIN-001/002, SEC-017 — the staff authentication realm.
 *
 * The properties under test are the ones that make it a realm rather than a login form:
 * two factors are both mandatory, a customer session is worthless here, an admin session
 * is worthless on customer routes, and a route that forgets to declare a permission is
 * refused rather than served.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
process.env.DEV_AUTH_ENABLED = 'true'
process.env.RATE_LIMIT_ENABLED = 'false'

const { createApp } = await import('../../src/bootstrap.js')
const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { hashPassword, generateTotpSecret, sealSecret, totpCode } = await import(
  '@autoservices/auth'
)

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>

const PASSWORD = 'AdminRealmTest123!'
const KEY = process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long'
const adminIds: string[] = []
const userIds: string[] = []
const workspaceIds: string[] = []

interface Admin {
  id: string
  email: string
  secret: string
}

async function createAdmin(role: string, opts: { enrolled?: boolean } = {}): Promise<Admin> {
  const enrolled = opts.enrolled ?? true
  const email = `admin-${role.toLowerCase()}-${Date.now()}${Math.random().toString(36).slice(2, 8)}@example.com`
  const secret = generateTotpSecret()
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      role: role as never,
      status: enrolled ? 'ACTIVE' : 'PENDING_MFA',
      mfaSecret: sealSecret(secret, KEY),
      mfaEnrolledAt: enrolled ? new Date() : null,
    },
  })
  adminIds.push(admin.id)
  return { id: admin.id, email, secret }
}

async function login(admin: Admin, over: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: admin.email,
      password: PASSWORD,
      totpCode: totpCode(admin.secret),
      ...over,
    }),
  })
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  return { res, cookie }
}

beforeAll(async () => {
  app = await createApp({
    sessionSecret: KEY,
    corsOrigins: ['http://localhost:3102'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()
}, 60_000)

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorAdminId: { in: adminIds } } })
  await prisma.adminSession.deleteMany({ where: { adminUserId: { in: adminIds } } })
  await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('two factors, both mandatory', () => {
  it('signs in with password and a valid code', async () => {
    const admin = await createAdmin('SUPER_ADMIN')
    const { res, cookie } = await login(admin)
    expect(res.status).toBe(200)
    expect(cookie).toContain('as_admin_session=')

    const body = await res.json()
    expect(body.data.admin.role).toBe('SUPER_ADMIN')
    expect(body.data.permissions).toContain('admin:admins:manage')
  })

  it('REFUSES a correct password with no code', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { res } = await login(admin, { totpCode: '000000' })
    expect(res.status).toBe(401)
  })

  it('REFUSES a correct code with the wrong password', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { res } = await login(admin, { password: 'not-the-password' })
    expect(res.status).toBe(401)
  })

  it('refuses a code from a different secret', async () => {
    const admin = await createAdmin('OPERATIONS')
    const other = generateTotpSecret()
    const { res } = await login(admin, { totpCode: totpCode(other) })
    expect(res.status).toBe(401)
  })

  it('completes enrolment on the first successful sign-in', async () => {
    // The operator already holds the secret from account creation and has just proved it
    // by producing a valid code. Requiring a separate confirmation step would deadlock:
    // confirming needs a session, and a session would need a completed enrolment.
    const admin = await createAdmin('SUPPORT', { enrolled: false })
    const { res } = await login(admin)
    expect(res.status).toBe(200)

    const row = await prisma.adminUser.findUnique({ where: { id: admin.id } })
    expect(row!.status).toBe('ACTIVE')
    expect(row!.mfaEnrolledAt).not.toBeNull()
  })

  it('still refuses a not-yet-enrolled account presenting a wrong code', async () => {
    const admin = await createAdmin('SUPPORT', { enrolled: false })
    const { res } = await login(admin, { totpCode: '000000' })
    expect(res.status).toBe(401)
    const row = await prisma.adminUser.findUnique({ where: { id: admin.id } })
    expect(row!.status).toBe('PENDING_MFA')
  })

  it('refuses an account with no second factor at all', async () => {
    const admin = await createAdmin('SUPPORT', { enrolled: false })
    await prisma.adminUser.update({ where: { id: admin.id }, data: { mfaSecret: null } })
    const { res } = await login(admin)
    expect(res.status).toBe(401)
  })

  it('gives the same answer for an unknown address as for a wrong password', async () => {
    const res = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'nobody@example.com',
        password: PASSWORD,
        totpCode: '123456',
      }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('INVALID_CREDENTIALS')
  })

  it('locks an account after repeated failures', async () => {
    const admin = await createAdmin('OPERATIONS')
    for (let i = 0; i < 5; i++) await login(admin, { password: 'wrong' })
    // Even the correct credentials are refused while locked.
    const { res } = await login(admin)
    expect(res.status).toBe(423)
  })
})

describe('the two realms are disjoint', () => {
  it('a customer session cannot reach an admin route', async () => {
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const email = `cust-${unique}@example.com`
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Customer' } },
      },
    })
    userIds.push(user.id)
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Customer garage',
        slug: `cust-${unique}`,
        type: 'PERSONAL',
        ownerUserId: user.id,
        members: {
          create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
        },
      },
    })
    workspaceIds.push(workspace.id)

    const loginRes = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const customerCookie = (
      loginRes.headers.getSetCookie?.()[0] ??
      loginRes.headers.get('set-cookie') ??
      ''
    ).split(';')[0]!

    const res = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
      headers: { cookie: customerCookie },
    })
    // 404: the admin surface does not confirm its existence to a customer.
    expect(res.status).toBe(404)
  })

  it('an admin session cannot reach a customer route', async () => {
    const admin = await createAdmin('SUPER_ADMIN')
    const { cookie } = await login(admin)
    const res = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie } })
    expect(res.status).toBe(401)
  })

  it('scopes the admin cookie to the admin API path', async () => {
    const admin = await createAdmin('SUPER_ADMIN')
    const res = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: admin.email,
        password: PASSWORD,
        totpCode: totpCode(admin.secret),
      }),
    })
    const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? ''
    // A browser will not attach it to a customer request at all.
    expect(raw).toContain('Path=/api/v1/admin')
    expect(raw).toContain('HttpOnly')
  })
})

describe('admin authorisation', () => {
  it('lets OPERATIONS read queues', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { cookie } = await login(admin)
    const res = await fetch(`${baseUrl}/api/v1/admin/queues`, { headers: { cookie } })
    expect(res.status).toBe(200)
  })

  it('REFUSES a role that lacks the permission', async () => {
    // BILLING has no business releasing an email suppression.
    const admin = await createAdmin('BILLING')
    const { cookie } = await login(admin)
    const res = await fetch(`${baseUrl}/api/v1/admin/suppressions/release`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com' }),
    })
    expect(res.status).toBe(403)
  })

  it('refuses READ_ONLY any mutation', async () => {
    const admin = await createAdmin('READ_ONLY')
    const { cookie } = await login(admin)
    const res = await fetch(`${baseUrl}/api/v1/admin/suppressions/release`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com' }),
    })
    expect(res.status).toBe(403)
  })

  it('refuses everything without a session', async () => {
    for (const route of ['/admin/metrics', '/admin/queues', '/admin/emails', '/admin/audit']) {
      const res = await fetch(`${baseUrl}/api/v1${route}`)
      expect(res.status, route).toBe(404)
    }
  })

  it('no longer accepts the old shared secret', async () => {
    // The header that used to be the entire access-control model.
    const res = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
      headers: { 'x-internal-token': KEY },
    })
    expect(res.status).toBe(404)
  })
})

describe('sessions', () => {
  it('reports the signed-in admin and their permissions', async () => {
    const admin = await createAdmin('SUPPORT')
    const { cookie } = await login(admin)
    const body = await (
      await fetch(`${baseUrl}/api/v1/admin/auth/session`, { headers: { cookie } })
    ).json()
    expect(body.data.admin.email).toBe(admin.email)
    expect(body.data.permissions).toContain('admin:users:read')
    expect(body.data.permissions).not.toContain('admin:billing:manage')
  })

  it('stops working after logout', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { cookie } = await login(admin)
    await fetch(`${baseUrl}/api/v1/admin/auth/logout`, { method: 'POST', headers: { cookie } })
    const res = await fetch(`${baseUrl}/api/v1/admin/queues`, { headers: { cookie } })
    expect(res.status).toBe(404)
  })

  it('expires after 8 hours, not the customer lifetime', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { cookie } = await login(admin)
    const session = await prisma.adminSession.findFirst({
      where: { adminUserId: admin.id },
      orderBy: { createdAt: 'desc' },
    })
    const hours = (session!.expiresAt.getTime() - session!.createdAt.getTime()) / 3_600_000
    expect(Math.round(hours)).toBe(8)

    // And an expired session is refused.
    await prisma.adminSession.update({
      where: { id: session!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await fetch(`${baseUrl}/api/v1/admin/queues`, { headers: { cookie } })).status).toBe(
      404,
    )
  })

  it('stores only the hash of the token', async () => {
    const admin = await createAdmin('OPERATIONS')
    const { cookie } = await login(admin)
    const token = cookie.split('=')[1]!
    const stored = await prisma.adminSession.findMany({ where: { adminUserId: admin.id } })
    for (const s of stored) expect(s.tokenHash).not.toBe(token)
  })

  it('never stores the TOTP secret in the clear', async () => {
    const admin = await createAdmin('OPERATIONS')
    const row = await prisma.adminUser.findUnique({ where: { id: admin.id } })
    expect(row!.mfaSecret).not.toContain(admin.secret)
    expect(row!.mfaSecret).toMatch(/^v1\./)
  })
})

describe('audit trail', () => {
  it('records sign-in and failure as ADMIN actions', async () => {
    const admin = await createAdmin('OPERATIONS')
    await login(admin, { password: 'wrong' })
    await login(admin)

    const rows = await prisma.auditLog.findMany({ where: { actorAdminId: admin.id } })
    const actions = rows.map((r) => r.action)
    expect(actions).toContain('admin.signed_in')
    expect(actions).toContain('admin.sign_in_failed')
    for (const row of rows) {
      expect(row.actorType).toBe('ADMIN')
      // A staff action is not attributed to a customer.
      expect(row.actorUserId).toBeNull()
      expect(JSON.stringify(row.metadata ?? {})).not.toContain(PASSWORD)
    }
  })
})
