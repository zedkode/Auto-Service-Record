/**
 * OWN-007/008 — the expense ledger and the projections that feed it.
 *
 * The rule under test is the one that makes reports trustworthy: `expenses` is the single
 * cost surface, and a service must never be counted both directly and through its
 * projection (DATABASE.md §4.8).
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

const today = new Date().toISOString().slice(0, 10)

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
  const email = `exp-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('ExpenseTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Expense Test' } },
    },
  })
  userIds.push(user.id)
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Expense garage',
      slug: `exp-${unique}`,
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
    data: { workspaceId, manufacturer: 'Expense', model: 'Tester', distanceUnit: 'MILES' },
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
  await prisma.reminder.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.insurancePolicy.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.roadTaxRecord.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.maintenanceCompletion.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.maintenanceRule.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.serviceRecordPart.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.serviceRecord.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.odometerEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
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

describe('manual expenses', () => {
  it('records one and returns it in the ledger', async () => {
    const res = await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        vehicleId,
        incurredOn: today,
        amount: '42.50',
        currency: 'GBP',
        vendorName: 'Car wash',
        description: 'Valet',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.amount).toBe('42.50')
    expect(body.data.isProjected).toBe(false)
  })

  it('rejects an amount that is not money', async () => {
    const res = await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({ incurredOn: today, amount: '10.999' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('a service projects itself exactly once', () => {
  let serviceId: string

  it('creates one expense when the service is recorded', async () => {
    const res = await api(`/vehicles/${vehicleId}/services`, {
      method: 'POST',
      body: JSON.stringify({
        performedOn: today,
        title: 'Major service',
        totalAmount: '450.00',
        currency: 'GBP',
        workshopName: 'Test Garage',
      }),
    })
    expect(res.status).toBe(201)
    serviceId = (await res.json()).data.id

    const rows = await prisma.expense.findMany({
      where: { sourceType: 'SERVICE', sourceRecordId: serviceId, deletedAt: null },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount.toFixed(2)).toBe('450.00')
  })

  it('updates that one row rather than adding a second when the service is edited', async () => {
    await api(`/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ totalAmount: '525.00' }),
    })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'SERVICE', sourceRecordId: serviceId, deletedAt: null },
    })
    // The whole point of the uniqueness rule: editing must not accumulate duplicates.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount.toFixed(2)).toBe('525.00')
  })

  it('withdraws the cost when the service total is cleared', async () => {
    await api(`/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ totalAmount: '0.00' }),
    })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'SERVICE', sourceRecordId: serviceId, deletedAt: null },
    })
    expect(rows).toHaveLength(0)
  })

  it('brings the cost back when a total is restored', async () => {
    await api(`/services/${serviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ totalAmount: '300.00' }),
    })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'SERVICE', sourceRecordId: serviceId, deletedAt: null },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount.toFixed(2)).toBe('300.00')
  })

  it('retracts the cost when the service is deleted', async () => {
    await api(`/services/${serviceId}`, { method: 'DELETE' })
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'SERVICE', sourceRecordId: serviceId, deletedAt: null },
    })
    expect(rows).toHaveLength(0)
  })
})

describe('insurance and road tax project too', () => {
  it('projects a premium into the ledger', async () => {
    const res = await api(`/vehicles/${vehicleId}/insurance-policies`, {
      method: 'POST',
      body: JSON.stringify({
        providerName: 'Projection Insurer',
        startsOn: today,
        premiumAmount: '620.00',
        currency: 'GBP',
      }),
    })
    const policyId = (await res.json()).data.id
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'INSURANCE', sourceRecordId: policyId, deletedAt: null },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.amount.toFixed(2)).toBe('620.00')
  })

  it('projects nothing for a policy with no premium recorded', async () => {
    const res = await api(`/vehicles/${vehicleId}/insurance-policies`, {
      method: 'POST',
      body: JSON.stringify({ providerName: 'No Premium Insurer', startsOn: today }),
    })
    const policyId = (await res.json()).data.id
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'INSURANCE', sourceRecordId: policyId, deletedAt: null },
    })
    // A blank premium is "not recorded", not a £0 cost.
    expect(rows).toHaveLength(0)
  })

  it('projects road tax', async () => {
    const res = await api(`/vehicles/${vehicleId}/road-tax`, {
      method: 'POST',
      body: JSON.stringify({ countryCode: 'GB', startsOn: today, amount: '180.00' }),
    })
    const taxId = (await res.json()).data.id
    const rows = await prisma.expense.findMany({
      where: { sourceType: 'TAX', sourceRecordId: taxId, deletedAt: null },
    })
    expect(rows).toHaveLength(1)
  })
})

describe('projected rows are read-only', () => {
  it('refuses to edit one, and says where to edit instead', async () => {
    const projected = await prisma.expense.findFirst({
      where: { workspaceId, sourceType: 'INSURANCE', deletedAt: null },
    })
    const res = await api(`/expenses/${projected!.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: '1.00' }),
    })
    expect(res.status).toBe(422)
    expect((await res.json()).error.message).toMatch(/insurance policy/i)
  })

  it('refuses to delete one', async () => {
    const projected = await prisma.expense.findFirst({
      where: { workspaceId, sourceType: 'INSURANCE', deletedAt: null },
    })
    const res = await api(`/expenses/${projected!.id}`, { method: 'DELETE' })
    expect(res.status).toBe(422)
  })
})

describe('summary', () => {
  it('totals the ledger without double-counting the projected service', async () => {
    const res = await api(`/expenses/summary?from=${today}&to=${today}`)
    expect(res.status).toBe(200)
    const s = (await res.json()).data

    const rows = await prisma.expense.findMany({
      where: { workspaceId, deletedAt: null, incurredOn: new Date(`${today}T00:00:00Z`) },
      select: { amount: true },
    })
    const expected = rows.reduce((sum, r) => sum + Number(r.amount), 0).toFixed(2)
    expect(s.total).toBe(expected)
    expect(s.byCategory.length).toBeGreaterThan(0)
  })

  it('refuses to sum across currencies', async () => {
    await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({ incurredOn: today, amount: '30.00', currency: 'EUR' }),
    })
    const s = (await (await api(`/expenses/summary?from=${today}&to=${today}`)).json()).data
    // There is no exchange rate in the platform, so a single figure would be a fiction.
    expect(s.mixedCurrencies).toBe(true)
    expect(s.currency).toBeNull()
  })
})
