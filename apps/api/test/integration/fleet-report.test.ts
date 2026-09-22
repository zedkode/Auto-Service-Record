/**
 * RPT-004 — the workspace as a fleet, end to end.
 *
 * The engine's rules are covered exhaustively in `fleet.engine.test.ts`. What this proves
 * is the wiring: that the numbers come from the same single cost surface the per-vehicle
 * report reads, that compliance is built from the actual inspection, policy and tax
 * records, and that a second workspace's vans never appear.
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

const iso = (offsetDays: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const YEAR = `from=${new Date().getUTCFullYear()}-01-01&to=${new Date().getUTCFullYear()}-12-31`

async function makeUser(prefix: string) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const email = `${prefix}-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('FleetTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Fleet' } },
    },
  })
  userIds.push(user.id)
  const ws = await prisma.workspace.create({
    data: {
      name: 'Fleet garage',
      slug: `${prefix}-${unique}`,
      type: 'BUSINESS',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(ws.id)
  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const c = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0]!
  return { userId: user.id, workspaceId: ws.id, cookie: c }
}

/** A van with a service cost and two mileage readings, so cost per mile is computable. */
async function van(name: string, cost: string, startMiles: number, endMiles: number) {
  const created = (
    await (
      await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Fleet',
          model: name,
          distanceUnit: 'MILES',
          currentOdometer: startMiles,
        }),
      })
    ).json()
  ).data

  await api(`/vehicles/${created.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: iso(-60),
      title: 'Service',
      totalAmount: cost,
      currency: 'GBP',
      odometer: endMiles,
    }),
  })
  return created.id
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

  const owner = await makeUser('fleet')
  cookie = owner.cookie
  workspaceId = owner.workspaceId
}, 60_000)

afterAll(async () => {
  await prisma.expense.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.odometerEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.fuelEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.reminder.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.inspectionAdvisory.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.vehicleInspection.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.insurancePolicy.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.roadTaxRecord.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
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

describe('the fleet report', () => {
  it('ranks vans by what they cost and works out each one per mile', async () => {
    const expensive = await van('Expensive', '900.00', 10_000, 19_000)
    await van('Cheap', '100.00', 5_000, 10_000)

    const res = await api(`/reports/fleet?${YEAR}`)
    expect(res.status).toBe(200)
    const report = (await res.json()).data

    expect(report.vehicles[0].vehicleId).toBe(expensive)
    expect(report.vehicles[0].total).toBe('900.00')
    // 900 over 9,000 miles.
    expect(report.vehicles[0].costPerDistance.perMile).toBe('0.100')
    expect(report.vehicles[1].costPerDistance.perMile).toBe('0.020')
    expect(report.fleet.vehicleCount).toBe(2)
    expect(report.fleet.total).toBe('1000.00')
  })

  it('agrees with the per-vehicle cost report, to the penny', async () => {
    const fleet = (await (await api(`/reports/fleet?${YEAR}`)).json()).data
    const costs = (await (await api(`/reports/costs?${YEAR}`)).json()).data
    // Both read `expenses` and nothing else; if they ever disagree, one of them started
    // summing source records directly.
    expect(fleet.fleet.total).toBe(costs.total)
    expect(fleet.fleet.entries).toBe(costs.entries)
  })

  it('reports the soonest real obligation, not the oldest MOT on file', async () => {
    const id = await van('Compliance', '10.00', 1_000, 2_000)

    // An expired MOT from years ago, then the current one. Only the current one counts.
    await api(`/vehicles/${id}/inspections`, {
      method: 'POST',
      body: JSON.stringify({ performedOn: iso(-800), expiresOn: iso(-435) }),
    })
    await api(`/vehicles/${id}/inspections`, {
      method: 'POST',
      body: JSON.stringify({ performedOn: iso(-70), expiresOn: iso(295) }),
    })
    // Tax runs out in a fortnight, so that is what the fleet manager should be shown.
    await api(`/vehicles/${id}/road-tax`, {
      method: 'POST',
      body: JSON.stringify({ startsOn: iso(-350), expiresOn: iso(14), amount: '180.00' }),
    })

    const report = (await (await api(`/reports/fleet?${YEAR}`)).json()).data
    const row = report.vehicles.find((v: { vehicleId: string }) => v.vehicleId === id)
    expect(row.compliance.kind).toBe('TAX')
    expect(row.compliance.state).toBe('DUE_SOON')
    expect(row.compliance.daysRemaining).toBe(14)
    expect(report.fleet.needingAttention).toBeGreaterThanOrEqual(1)
  })

  it('says UNKNOWN for a van with nothing recorded, never OK', async () => {
    const id = await van('Undocumented', '10.00', 100, 200)
    const report = (await (await api(`/reports/fleet?${YEAR}`)).json()).data
    const row = report.vehicles.find((v: { vehicleId: string }) => v.vehicleId === id)
    expect(row.compliance.state).toBe('UNKNOWN')
    expect(row.compliance.expiresOn).toBeNull()
  })

  it('drops a van that was removed, along with its costs', async () => {
    const id = await van('Removed', '500.00', 1_000, 3_000)
    const before = (await (await api(`/reports/fleet?${YEAR}`)).json()).data

    await api(`/vehicles/${id}`, { method: 'DELETE' })
    const after = (await (await api(`/reports/fleet?${YEAR}`)).json()).data

    expect(after.vehicles.some((v: { vehicleId: string }) => v.vehicleId === id)).toBe(false)
    expect(after.fleet.vehicleCount).toBe(before.fleet.vehicleCount - 1)
    expect(Number(before.fleet.total) - Number(after.fleet.total)).toBeCloseTo(500, 2)
  })

  it('never shows one workspace another workspace’s fleet', async () => {
    const stranger = await makeUser('fleet-x')
    const res = await fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/reports/fleet?${YEAR}`, {
      headers: { cookie: stranger.cookie },
    })
    // 404 rather than 403: a non-member is not told the workspace exists.
    expect(res.status).toBe(404)
  })

  it('refuses a backwards date range', async () => {
    const res = await api('/reports/fleet?from=2026-12-31&to=2026-01-01')
    expect(res.status).toBe(422)
  })
})
