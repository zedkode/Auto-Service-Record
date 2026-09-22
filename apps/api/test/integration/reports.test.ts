/**
 * RPT-001/002 — the cost report over real data.
 *
 * The engine's own tests cover the arithmetic exhaustively; this file proves the report
 * reads the right rows: the single cost surface (so nothing is counted twice) and the
 * append-only mileage history (so distance is evidence).
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

const YEAR = { from: '2026-01-01', to: '2026-12-31' }
const costs = async (over: Record<string, string> = {}) => {
  const q = new URLSearchParams({ ...YEAR, ...over })
  return (await (await api(`/reports/costs?${q}`)).json()).data
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

  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const email = `rpt-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('ReportTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Report Test' } },
    },
  })
  userIds.push(user.id)
  const ws = await prisma.workspace.create({
    data: {
      name: 'Report garage',
      slug: `rpt-${unique}`,
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
    data: { workspaceId, manufacturer: 'Report', model: 'Car', distanceUnit: 'KILOMETERS' },
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
  await prisma.serviceRecordPart.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.maintenanceCompletion.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.maintenanceRule.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.serviceRecord.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
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

describe('an empty period', () => {
  it('reports zero without inventing anything', async () => {
    const r = await costs()
    expect(r.total).toBe('0.00')
    expect(r.entries).toBe(0)
    expect(r.costPerDistance.perMile).toBeNull()
    expect(r.distance.unavailableReason).toBe('NO_READINGS')
  })

  it('still returns a bucket for every month', async () => {
    const r = await costs()
    expect(r.byMonth).toHaveLength(12)
  })
})

describe('reading the single cost surface', () => {
  it('counts a service once, through its projection', async () => {
    await api(`/vehicles/${vehicleId}/services`, {
      method: 'POST',
      body: JSON.stringify({
        performedOn: '2026-02-10',
        title: 'Major service',
        totalAmount: '600.00',
        currency: 'GBP',
        odometer: 10_000,
      }),
    })

    const r = await costs()
    // 600, not 1200: the service record and its projected expense are the same money.
    expect(r.total).toBe('600.00')
    expect(r.entries).toBe(1)
    expect(r.byCategory[0]!.key).toBe('servicing')
  })

  it('includes fuel, which reaches the ledger the same way', async () => {
    await api(`/vehicles/${vehicleId}/fuel`, {
      method: 'POST',
      body: JSON.stringify({
        filledOn: '2026-03-01',
        odometer: 11_000,
        quantity: 50,
        quantityUnit: 'LITRES',
        isFullTank: true,
        totalAmount: '70.00',
      }),
    })

    const r = await costs()
    expect(r.total).toBe('670.00')
    expect(r.byCategory.map((c: { key: string }) => c.key).sort()).toEqual(['fuel', 'servicing'])
  })

  it('puts each cost in the month it was incurred', async () => {
    const r = await costs()
    const february = r.byMonth.find((m: { month: string }) => m.month === '2026-02')
    const march = r.byMonth.find((m: { month: string }) => m.month === '2026-03')
    expect(february.total).toBe('600.00')
    expect(march.total).toBe('70.00')
  })
})

describe('cost per distance', () => {
  it('uses the mileage the service and the fill recorded', async () => {
    // 10,000 → 11,000 km on £670.
    const r = await costs()
    expect(r.distance.kilometres).toBe(1000)
    expect(r.costPerDistance.perKilometre).toBe('0.670')
    expect(r.costPerDistance.perMile).toBe('1.078')
  })

  it('ignores an odometer correction, which restates rather than records travel', async () => {
    const before = await costs()
    await prisma.odometerEntry.create({
      data: {
        workspaceId,
        vehicleId,
        value: 99_000,
        unit: 'KILOMETERS',
        recordedOn: new Date('2026-04-01T00:00:00Z'),
        source: 'MANUAL',
        isCorrection: true,
        correctionReason: 'Typo in an earlier reading',
      },
    })
    const after = await costs()
    // Including it would claim 89,000 km of travel that never happened.
    expect(after.distance.kilometres).toBe(before.distance.kilometres)
  })
})

describe('period and filters', () => {
  it('excludes costs outside the period', async () => {
    const r = await costs({ from: '2026-03-01', to: '2026-03-31' })
    expect(r.total).toBe('70.00')
    expect(r.entries).toBe(1)
  })

  it('refuses a period that runs backwards', async () => {
    const res = await api('/reports/costs?from=2026-12-31&to=2026-01-01')
    expect(res.status).toBe(422)
  })

  it('refuses a malformed date', async () => {
    const res = await api('/reports/costs?from=last-tuesday&to=2026-01-01')
    expect(res.status).toBe(422)
  })

  it('filters to one vehicle', async () => {
    const other = await prisma.vehicle.create({
      data: { workspaceId, manufacturer: 'Other', model: 'Car', distanceUnit: 'KILOMETERS' },
    })
    const r = await costs({ vehicleId: other.id })
    expect(r.total).toBe('0.00')
  })

  it('404s for a vehicle in another workspace', async () => {
    const res = await api('/reports/costs?vehicleId=00000000-0000-7000-8000-000000000000')
    expect(res.status).toBe(404)
  })

  it('names each vehicle in the breakdown', async () => {
    const r = await costs()
    expect(r.byVehicle[0]!.name).toBe('Report Car')
  })
})

describe('honesty', () => {
  it('refuses to annualise a fortnight', async () => {
    const r = await costs({ from: '2026-02-01', to: '2026-02-14' })
    expect(r.costPerYear.amount).toBeNull()
    expect(r.costPerYear.unavailableReason).toBe('PERIOD_TOO_SHORT')
  })

  it('annualises a full year without calling it a projection', async () => {
    const r = await costs()
    expect(r.costPerYear.projected).toBe(false)
    expect(r.costPerYear.amount).toBe('670.00')
  })

  it('refuses every derived figure once currencies are mixed', async () => {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId,
        incurredOn: '2026-05-01',
        amount: '30.00',
        currency: 'EUR',
      }),
    })
    const r = await costs()
    expect(r.mixedCurrencies).toBe(true)
    expect(r.currency).toBeNull()
    expect(r.costPerDistance.unavailableReason).toBe('MIXED_CURRENCIES')
    expect(r.costPerYear.unavailableReason).toBe('MIXED_CURRENCIES')
  })
})

describe('permissions', () => {
  it('refuses a DRIVER, who sees no financial data', async () => {
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const driver = await prisma.user.create({
      data: {
        email: `rpt-driver-${unique}@example.com`,
        passwordHash: await hashPassword('ReportTest123!'),
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
      `${baseUrl}/api/v1/workspaces/${workspaceId}/reports/costs?from=${YEAR.from}&to=${YEAR.to}`,
      { headers: { cookie: driverCookie } },
    )
    expect(res.status).toBe(403)
  })
})
