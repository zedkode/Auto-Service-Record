/**
 * SEC-018 — audited, time-boxed support access.
 *
 * No admin role can read customer content without a grant, so these tests are the proof
 * that the grant is the only route in, that it expires, and that **every use** leaves a
 * record — a grant used silently for a day is indistinguishable from unrestricted access.
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

const PASSWORD = 'SupportAccessTest123!'
const KEY = process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long'
const REASON = 'Customer ticket 4821 — cannot see their MOT certificate after renewal.'

const adminIds: string[] = []
const userIds: string[] = []
const workspaceIds: string[] = []

interface Staff {
  id: string
  email: string
  cookie: string
}

async function staff(role: string): Promise<Staff> {
  const email = `sa-${role.toLowerCase()}-${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.com`
  const secret = generateTotpSecret()
  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await hashPassword(PASSWORD),
      role: role as never,
      status: 'ACTIVE',
      mfaSecret: sealSecret(secret, KEY),
      mfaEnrolledAt: new Date(),
    },
  })
  adminIds.push(admin.id)

  const res = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, totpCode: totpCode(secret) }),
  })
  if (!res.ok) throw new Error(`admin login failed: ${res.status}`)
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]!
  return { id: admin.id, email, cookie }
}

let workspaceId: string
let vehicleId: string

const call = (s: Staff, p: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/v1${p}`, {
    ...init,
    headers: {
      cookie: s.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

const grantBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ workspaceId, reason: REASON, scope: 'FULL', hours: 4, ...over })

beforeAll(async () => {
  app = await createApp({
    sessionSecret: KEY,
    corsOrigins: ['http://localhost:3102'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()

  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const user = await prisma.user.create({
    data: {
      email: `sa-cust-${unique}@example.com`,
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Support Customer' } },
    },
  })
  userIds.push(user.id)
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Support garage',
      slug: `sa-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(workspace.id)
  workspaceId = workspace.id
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId,
      manufacturer: 'Support',
      model: 'Subject',
      registrationNumber: 'SA01 TST',
      distanceUnit: 'MILES',
    },
  })
  vehicleId = vehicle.id
}, 60_000)

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.auditLog.deleteMany({ where: { actorAdminId: { in: adminIds } } })
  await prisma.supportAccessGrant.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  // Documents hold the vehicle with ON DELETE RESTRICT, so they go before it.
  await prisma.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.adminSession.deleteMany({ where: { adminUserId: { in: adminIds } } })
  await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } })
  await prisma.vehicle.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('content is unreachable without a grant', () => {
  it('refuses vehicle content to a SUPER_ADMIN with no grant', async () => {
    // The most privileged role there is. Privilege is not the mechanism here.
    const s = await staff('SUPER_ADMIN')
    const res = await call(s, `/admin/workspaces/${workspaceId}/vehicles`)
    expect(res.status).toBe(404)
  })

  it('refuses document metadata with no grant', async () => {
    const s = await staff('SUPPORT')
    const res = await call(s, `/admin/workspaces/${workspaceId}/documents`)
    expect(res.status).toBe(404)
  })

  it('records the refusal — a denied attempt is worth seeing', async () => {
    const s = await staff('SUPPORT')
    await call(s, `/admin/workspaces/${workspaceId}/vehicles`)
    const denied = await prisma.auditLog.findFirst({
      where: { actorAdminId: s.id, action: 'support_access.denied' },
    })
    expect(denied).not.toBeNull()
    expect(denied!.workspaceId).toBe(workspaceId)
  })

  it('still allows metadata, which is most of support', async () => {
    const s = await staff('SUPPORT')
    const res = await call(s, `/admin/workspaces/${workspaceId}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.counts.vehicles).toBeGreaterThan(0)
    // Counts, not content: no registration numbers here.
    expect(JSON.stringify(body.data)).not.toContain('SA01 TST')
  })
})

describe('requesting a grant', () => {
  it('requires a reason that is actually a reason', async () => {
    const s = await staff('SUPPORT')
    const res = await call(s, '/admin/support-access', {
      method: 'POST',
      body: grantBody({ reason: 'debugging' }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses to last longer than 24 hours', async () => {
    const s = await staff('SUPPORT')
    const res = await call(s, '/admin/support-access', {
      method: 'POST',
      body: grantBody({ hours: 48 }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses a role that cannot request one', async () => {
    const s = await staff('BILLING')
    const res = await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    expect(res.status).toBe(403)
  })

  it('grants, and records the reason verbatim', async () => {
    const s = await staff('SUPPORT')
    const res = await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    expect(res.status).toBe(201)
    const grant = (await res.json()).data
    expect(grant.isActive).toBe(true)
    expect(grant.minutesRemaining).toBeGreaterThan(200)

    const row = await prisma.auditLog.findFirst({
      where: { actorAdminId: s.id, action: 'support_access.granted' },
    })
    expect(JSON.stringify(row!.metadata)).toContain('ticket 4821')
  })

  it('returns the live grant instead of stacking a second one', async () => {
    const s = await staff('SUPPORT')
    const first = await (
      await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    ).json()
    const second = await (
      await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    ).json()
    expect(second.data.id).toBe(first.data.id)
  })
})

describe('using a grant', () => {
  it('opens the content it covers', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })

    const res = await call(s, `/admin/workspaces/${workspaceId}/vehicles`)
    expect(res.status).toBe(200)
    const vehicles = (await res.json()).data
    expect(vehicles[0].registrationNumber).toBe('SA01 TST')
  })

  it('records EVERY use, not just the granting', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    await call(s, `/admin/workspaces/${workspaceId}/vehicles`)
    await call(s, `/admin/workspaces/${workspaceId}/vehicles`)
    await call(s, `/admin/workspaces/${workspaceId}/documents`)

    const uses = await prisma.auditLog.findMany({
      where: { actorAdminId: s.id, action: { startsWith: 'support_access.used' } },
    })
    expect(uses).toHaveLength(3)

    const grant = await prisma.supportAccessGrant.findFirst({ where: { adminUserId: s.id } })
    expect(grant!.useCount).toBe(3)
    expect(grant!.lastUsedAt).not.toBeNull()
  })

  it('honours the scope — a DOCUMENTS grant does not open vehicles', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', {
      method: 'POST',
      body: grantBody({ scope: 'DOCUMENTS' }),
    })
    expect((await call(s, `/admin/workspaces/${workspaceId}/documents`)).status).toBe(200)
    expect((await call(s, `/admin/workspaces/${workspaceId}/vehicles`)).status).toBe(404)
  })

  it('does not open a different workspace', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    const other = await prisma.workspace.findFirst({ where: { id: { not: workspaceId } } })
    if (other) {
      expect((await call(s, `/admin/workspaces/${other.id}/vehicles`)).status).toBe(404)
    }
  })

  it('stops working the moment it expires', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', { method: 'POST', body: grantBody({ hours: 1 }) })
    expect((await call(s, `/admin/workspaces/${workspaceId}/vehicles`)).status).toBe(200)

    await prisma.supportAccessGrant.updateMany({
      where: { adminUserId: s.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await call(s, `/admin/workspaces/${workspaceId}/vehicles`)).status).toBe(404)
  })

  it('stops working the moment it is revoked', async () => {
    const s = await staff('SUPPORT')
    const grant = await (
      await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    ).json()
    expect((await call(s, `/admin/workspaces/${workspaceId}/vehicles`)).status).toBe(200)

    const revoked = await call(s, `/admin/support-access/${grant.data.id}`, { method: 'DELETE' })
    expect(revoked.status).toBe(200)
    expect((await call(s, `/admin/workspaces/${workspaceId}/vehicles`)).status).toBe(404)
  })

  it('never hands over a document’s contents or storage key', async () => {
    const s = await staff('SUPPORT')
    await call(s, '/admin/support-access', { method: 'POST', body: grantBody() })
    await prisma.document.create({
      data: {
        workspaceId,
        vehicleId,
        storageKey: `workspaces/${workspaceId}/2026/09/support-test.pdf`,
        originalFilename: 'private-invoice.pdf',
        contentType: 'application/pdf',
        byteSize: 100,
        status: 'AVAILABLE',
      },
    })
    const body = await (await call(s, `/admin/workspaces/${workspaceId}/documents`)).json()
    const serialised = JSON.stringify(body.data)
    // Staff can see a file exists and help find it; reading it is not support.
    expect(serialised).toContain('private-invoice.pdf')
    expect(serialised).not.toContain('storageKey')
    expect(serialised).not.toContain('workspaces/')
    expect(serialised).not.toContain('X-Amz-Signature')
  })
})

describe('the register', () => {
  it('is visible to roles that cannot request access', async () => {
    const requester = await staff('SUPPORT')
    await call(requester, '/admin/support-access', { method: 'POST', body: grantBody() })

    const watcher = await staff('READ_ONLY')
    const body = await (await call(watcher, '/admin/support-access')).json()
    expect(body.data.some((g: { adminEmail: string }) => g.adminEmail === requester.email)).toBe(
      true,
    )
  })

  it('refuses one admin revoking another’s grant unless SUPER_ADMIN', async () => {
    const owner = await staff('SUPPORT')
    const grant = await (
      await call(owner, '/admin/support-access', { method: 'POST', body: grantBody() })
    ).json()

    const peer = await staff('SUPPORT')
    expect(
      (await call(peer, `/admin/support-access/${grant.data.id}`, { method: 'DELETE' })).status,
    ).toBe(403)

    const boss = await staff('SUPER_ADMIN')
    expect(
      (await call(boss, `/admin/support-access/${grant.data.id}`, { method: 'DELETE' })).status,
    ).toBe(200)
  })
})
