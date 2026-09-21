/**
 * OWN-001/002/003 — inspections, insurance and road tax.
 *
 * Asserts the parts that are easy to get wrong and expensive when wrong: cross-tenant
 * access, the money filter for roles without financial visibility, and the rule that
 * renewing an obligation stops the old one nagging.
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
const { hashPassword } = await import('@autoservices/auth')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

let baseUrl: string
let app: Awaited<ReturnType<typeof createApp>>

interface Actor {
  cookie: string
  userId: string
  workspaceId: string
  vehicleId: string
}
const createdUserIds: string[] = []
const createdWorkspaceIds: string[] = []

async function createActor(label: string, role = 'OWNER'): Promise<Actor> {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const email = `own-${label}-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('OwnershipTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: label } },
    },
  })
  createdUserIds.push(user.id)
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label} garage`,
      slug: `own-${label}-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: role as never, status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  createdWorkspaceIds.push(workspace.id)
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId: workspace.id,
      manufacturer: 'Ownership',
      model: label,
      distanceUnit: 'MILES',
    },
  })
  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`dev-login failed for ${label}: ${res.status}`)
  const setCookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? ''
  return {
    cookie: setCookie.split(';')[0]!,
    userId: user.id,
    workspaceId: workspace.id,
    vehicleId: vehicle.id,
  }
}

const api = (actor: Actor, pathname: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/v1/workspaces/${actor.workspaceId}${pathname}`, {
    ...init,
    headers: {
      cookie: actor.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

let owner: Actor
let other: Actor
let driver: Actor

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3100'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()
  owner = await createActor('owner')
  other = await createActor('other')
  driver = await createActor('driver', 'DRIVER')
}, 60_000)

afterAll(async () => {
  // Expenses projected from the policies and tax records hold the vehicle with
  // ON DELETE RESTRICT, so they go before it.
  await prisma.expense.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.reminder.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.inspectionAdvisory.deleteMany({
    where: { workspaceId: { in: createdWorkspaceIds } },
  })
  await prisma.vehicleInspection.deleteMany({
    where: { workspaceId: { in: createdWorkspaceIds } },
  })
  await prisma.insurancePolicy.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.roadTaxRecord.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.vehicle.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } })
  await prisma.workspaceMember.deleteMany({
    where: { workspaceId: { in: createdWorkspaceIds } },
  })
  await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('inspections', () => {
  it('creates an inspection with advisories', async () => {
    const res = await api(owner, `/vehicles/${owner.vehicleId}/inspections`, {
      method: 'POST',
      body: JSON.stringify({
        inspectionType: 'MOT',
        result: 'PASS_WITH_ADVISORIES',
        performedOn: '2026-09-01',
        expiresOn: '2027-08-31',
        odometer: 52000,
        odometerUnit: 'MILES',
        centreName: 'Test MOT Centre',
        advisories: [
          { severity: 'MINOR', text: 'Nearside front tyre worn close to the limit' },
          { severity: 'MAJOR', text: 'Brake pipe corroded' },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.advisories).toHaveLength(2)
    expect(body.data.unresolvedAdvisories).toBe(2)
    expect(body.data.expiresOn).toBe('2027-08-31')
  })

  it('rejects an expiry before the inspection date', async () => {
    const res = await api(owner, `/vehicles/${owner.vehicleId}/inspections`, {
      method: 'POST',
      body: JSON.stringify({ performedOn: '2026-09-01', expiresOn: '2025-01-01' }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses to attach an inspection to another workspace’s vehicle', async () => {
    const res = await api(owner, `/vehicles/${other.vehicleId}/inspections`, {
      method: 'POST',
      body: JSON.stringify({ performedOn: '2026-09-01' }),
    })
    expect(res.status).toBe(404)
  })

  it('does not leak another workspace’s inspections', async () => {
    const res = await api(other, '/inspections')
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(0)
  })

  it('resolves an advisory', async () => {
    const list = await (await api(owner, '/inspections')).json()
    const advisory = list.data[0].advisories[0]
    const res = await api(owner, `/advisories/${advisory.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isResolved: true }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.isResolved).toBe(true)
  })

  it('soft-deletes rather than destroying history', async () => {
    const created = await (
      await api(owner, `/vehicles/${owner.vehicleId}/inspections`, {
        method: 'POST',
        body: JSON.stringify({ performedOn: '2020-01-01', expiresOn: '2021-01-01' }),
      })
    ).json()
    const res = await api(owner, `/inspections/${created.data.id}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    const row = await prisma.vehicleInspection.findUnique({ where: { id: created.data.id } })
    expect(row).not.toBeNull()
    expect(row?.deletedAt).not.toBeNull()
  })
})

describe('insurance', () => {
  it('stores money as an exact decimal string', async () => {
    const res = await api(owner, `/vehicles/${owner.vehicleId}/insurance-policies`, {
      method: 'POST',
      body: JSON.stringify({
        providerName: 'Test Insurer',
        startsOn: '2026-09-01',
        expiresOn: '2027-08-31',
        premiumAmount: '499.99',
        excessAmount: '250.00',
        currency: 'GBP',
        renewalType: 'AUTOMATIC',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.premiumAmount).toBe('499.99')
    expect(body.data.currency).toBe('GBP')
  })

  it('hides money from a role without financial visibility', async () => {
    // Seeded directly: a DRIVER cannot create one (asserted separately below), but must
    // still be able to READ the cover on a vehicle they drive.
    const created = await prisma.insurancePolicy.create({
      data: {
        workspaceId: driver.workspaceId,
        vehicleId: driver.vehicleId,
        providerName: 'Driver Visible Insurer',
        startsOn: new Date('2026-09-01T00:00:00Z'),
        expiresOn: new Date('2027-08-31T00:00:00Z'),
        premiumAmount: '900.00',
        currency: 'GBP',
      },
    })
    expect(created.id).toBeTruthy()

    const res = await api(driver, '/insurance-policies')
    expect(res.status).toBe(200)
    const policy = (await res.json()).data[0]
    // ...but can see that cover exists and when it ends, because driving uninsured is
    // an offence. The premium is not theirs to see.
    expect(policy.providerName).toBe('Driver Visible Insurer')
    expect(policy.expiresOn).toBe('2027-08-31')
    expect(policy).not.toHaveProperty('premiumAmount')
    expect(policy).not.toHaveProperty('excessAmount')
  })

  it('refuses writes from a role without ownership:write', async () => {
    const res = await api(driver, `/vehicles/${driver.vehicleId}/insurance-policies`, {
      method: 'POST',
      body: JSON.stringify({ providerName: 'Nope', startsOn: '2026-09-01' }),
    })
    expect(res.status).toBe(403)
  })
})

describe('road tax', () => {
  it('is not hard-coded to the UK', async () => {
    const res = await api(owner, `/vehicles/${owner.vehicleId}/road-tax`, {
      method: 'POST',
      body: JSON.stringify({
        countryCode: 'ro',
        startsOn: '2026-09-01',
        expiresOn: '2027-08-31',
        amount: '120.00',
      }),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).data.countryCode).toBe('RO')
  })
})

describe('renewal supersedes the record it replaces', () => {
  it('cancels an open reminder for the previous inspection', async () => {
    const first = await (
      await api(owner, `/vehicles/${owner.vehicleId}/inspections`, {
        method: 'POST',
        body: JSON.stringify({ performedOn: '2025-09-01', expiresOn: '2026-08-31' }),
      })
    ).json()

    // Simulate the engine having already raised a reminder for the expired certificate.
    const reminder = await prisma.reminder.create({
      data: {
        workspaceId: owner.workspaceId,
        vehicleId: owner.vehicleId,
        sourceType: 'INSPECTION',
        sourceId: first.data.id,
        title: 'MOT has expired',
        status: 'DUE',
      },
    })

    await api(owner, `/vehicles/${owner.vehicleId}/inspections`, {
      method: 'POST',
      body: JSON.stringify({ performedOn: '2026-09-02', expiresOn: '2027-09-01' }),
    })

    const after = await prisma.reminder.findUnique({ where: { id: reminder.id } })
    // Without this, renewing the MOT this morning would still say it expired.
    expect(after?.status).toBe('CANCELLED')
  })
})
