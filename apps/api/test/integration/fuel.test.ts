/**
 * OWN-006 — fuel entries, and the two things they feed: the mileage history and the
 * expense ledger. The economy arithmetic itself is covered exhaustively by the engine's
 * own unit tests; this file proves the wiring.
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
let cookie: string
let workspaceId: string
let vehicleId: string
const userIds: string[] = []
const workspaceIds: string[] = []

const api = (pathname: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}${pathname}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

const addFill = (over: Record<string, unknown>) =>
  api(`/vehicles/${vehicleId}/fuel`, {
    method: 'POST',
    body: JSON.stringify({
      filledOn: '2026-09-01',
      quantity: 50,
      quantityUnit: 'LITRES',
      isFullTank: true,
      ...over,
    }),
  })

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3101'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()

  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const email = `fuel-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('FuelTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Fuel Test' } },
    },
  })
  userIds.push(user.id)
  const ws = await prisma.workspace.create({
    data: {
      name: 'Fuel garage',
      slug: `fuel-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(ws.id)
  workspaceId = ws.id
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId,
      manufacturer: 'Fuel',
      model: 'Tester',
      distanceUnit: 'KILOMETERS',
      fuelType: 'DIESEL',
    },
  })
  vehicleId = vehicle.id

  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0]!
}, 60_000)

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.odometerEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.fuelEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.vehicle.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('recording a fill', () => {
  it('stores the quantity to three decimals', async () => {
    const res = await addFill({ odometer: 10_000, quantity: 42.375, totalAmount: '68.20' })
    expect(res.status).toBe(201)
    const entry = (await res.json()).data
    expect(entry.quantity).toBe(42.375)
    expect(entry.totalAmount).toBe('68.20')
  })

  it('adds the reading to the vehicle’s mileage history, attributed to the fill', async () => {
    const entries = await prisma.odometerEntry.findMany({
      where: { vehicleId, source: 'FUEL' },
    })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]!.value).toBe(10_000)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    expect(vehicle!.currentOdometer).toBe(10_000)
  })

  it('takes the fuel type from the vehicle when none is given', async () => {
    const entry = await prisma.fuelEntry.findFirst({ where: { vehicleId, odometer: 10_000 } })
    expect(entry!.fuelType).toBe('DIESEL')
  })

  it('refuses a partial fill marked as a missed fill', async () => {
    // A missed fill is recorded on the next FULL fill; on a partial it means nothing.
    const res = await addFill({ odometer: 10_100, isFullTank: false, missedFill: true })
    expect(res.status).toBe(422)
  })

  it('refuses a quantity of zero', async () => {
    const res = await addFill({ odometer: 10_200, quantity: 0 })
    expect(res.status).toBe(422)
  })
})

describe('the expense ledger (OWN-008)', () => {
  it('projects the fill as a cost', async () => {
    const entry = await prisma.fuelEntry.findFirst({ where: { vehicleId, odometer: 10_000 } })
    const projected = await prisma.expense.findFirst({
      where: { sourceType: 'FUEL', sourceRecordId: entry!.id, deletedAt: null },
      include: { category: true },
    })
    expect(projected).not.toBeNull()
    expect(projected!.amount.toFixed(2)).toBe('68.20')
    // Lands in the fuel category, not a generic bucket.
    expect(projected!.category!.key).toBe('fuel')
  })

  it('updates that row rather than adding another when the fill is edited', async () => {
    const entry = await prisma.fuelEntry.findFirst({ where: { vehicleId, odometer: 10_000 } })
    await api(`/fuel/${entry!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ totalAmount: '71.00' }),
    })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'FUEL', sourceRecordId: entry!.id, deletedAt: null },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount.toFixed(2)).toBe('71.00')
  })

  it('projects nothing when no amount was recorded', async () => {
    const res = await addFill({ odometer: 10_300 })
    const entry = (await res.json()).data
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'FUEL', sourceRecordId: entry.id, deletedAt: null },
    })
    // A blank price is "not recorded", not a free tank (DECISIONS.md D-056).
    expect(rows).toHaveLength(0)
  })

  it('withdraws the cost when the fill is deleted', async () => {
    const res = await addFill({ odometer: 10_400, totalAmount: '50.00' })
    const entry = (await res.json()).data
    await api(`/fuel/${entry.id}`, { method: 'DELETE' })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'FUEL', sourceRecordId: entry.id, deletedAt: null },
    })
    expect(rows).toHaveLength(0)

    // Soft delete: the fill survives, because removing it would silently change every
    // economy figure computed around it.
    const row = await prisma.fuelEntry.findUnique({ where: { id: entry.id } })
    expect(row!.deletedAt).not.toBeNull()
  })
})

describe('economy', () => {
  it('says why there is no figure yet instead of inventing one', async () => {
    const fresh = await prisma.vehicle.create({
      data: { workspaceId, manufacturer: 'Lonely', model: 'Car', distanceUnit: 'KILOMETERS' },
    })
    const body = await (await api(`/vehicles/${fresh.id}/fuel/economy`)).json()
    expect(body.data.average).toBeNull()
    expect(body.data.unavailableReason).toBe('NO_FILLS')
  })

  it('computes a figure once two full fills exist', async () => {
    const v = await prisma.vehicle.create({
      data: { workspaceId, manufacturer: 'Economy', model: 'Car', distanceUnit: 'KILOMETERS' },
    })
    for (const [odometer, quantity] of [
      [0, 50],
      [500, 50],
    ] as const) {
      await api(`/vehicles/${v.id}/fuel`, {
        method: 'POST',
        body: JSON.stringify({
          filledOn: '2026-09-01',
          odometer,
          quantity,
          quantityUnit: 'LITRES',
          isFullTank: true,
        }),
      })
    }
    const body = await (await api(`/vehicles/${v.id}/fuel/economy`)).json()
    expect(body.data.average.litresPer100Km).toBe(10)
    expect(body.data.intervals).toHaveLength(1)
  })
})

describe('permissions', () => {
  it('lets a DRIVER record a fill — they are the one filling up', async () => {
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const driver = await prisma.user.create({
      data: {
        email: `fuel-driver-${unique}@example.com`,
        passwordHash: await hashPassword('FuelTest123!'),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Driver' } },
      },
    })
    userIds.push(driver.id)
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: driver.id,
        role: 'DRIVER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const login = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: driver.email }),
    })
    const driverCookie = (
      login.headers.getSetCookie?.()[0] ??
      login.headers.get('set-cookie') ??
      ''
    ).split(';')[0]!

    const res = await fetch(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/vehicles/${vehicleId}/fuel`,
      {
        method: 'POST',
        headers: { cookie: driverCookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          filledOn: '2026-09-02',
          odometer: 10_500,
          quantity: 45,
          quantityUnit: 'LITRES',
          isFullTank: true,
        }),
      },
    )
    expect(res.status).toBe(201)
  })

  it('refuses a VIEWER', async () => {
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const viewer = await prisma.user.create({
      data: {
        email: `fuel-viewer-${unique}@example.com`,
        passwordHash: await hashPassword('FuelTest123!'),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Viewer' } },
      },
    })
    userIds.push(viewer.id)
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: viewer.id,
        role: 'VIEWER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const login = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: viewer.email }),
    })
    const viewerCookie = (
      login.headers.getSetCookie?.()[0] ??
      login.headers.get('set-cookie') ??
      ''
    ).split(';')[0]!

    const res = await fetch(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/vehicles/${vehicleId}/fuel`,
      {
        method: 'POST',
        headers: { cookie: viewerCookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          filledOn: '2026-09-02',
          odometer: 10_600,
          quantity: 45,
          quantityUnit: 'LITRES',
          isFullTank: true,
        }),
      },
    )
    expect(res.status).toBe(403)
  })
})
