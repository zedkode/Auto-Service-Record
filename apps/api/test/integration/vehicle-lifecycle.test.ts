/**
 * VEH-003 — status lifecycle, archival and soft delete.
 *
 * The rule under test is the one the product exists to protect: history survives every
 * one of these operations. A vehicle is never hard-deleted by a user action
 * (DATABASE.md §5 rule 1), so selling, archiving and deleting must all leave the service
 * records, fills and mileage exactly where they were.
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

/** A vehicle with a service, a fill and mileage behind it. */
async function vehicleWithHistory(name: string) {
  const created = (
    await (
      await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Lifecycle',
          model: name,
          distanceUnit: 'KILOMETERS',
        }),
      })
    ).json()
  ).data

  await api(`/vehicles/${created.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: '2026-02-10',
      title: 'Full service',
      totalAmount: '450.00',
      currency: 'GBP',
      odometer: 10_000,
    }),
  })
  await api(`/vehicles/${created.id}/fuel`, {
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
  return created.id
}

const historyOf = async (vehicleId: string) => ({
  services: await prisma.serviceRecord.count({ where: { vehicleId, deletedAt: null } }),
  fuel: await prisma.fuelEntry.count({ where: { vehicleId, deletedAt: null } }),
  odometer: await prisma.odometerEntry.count({ where: { vehicleId } }),
  expenses: await prisma.expense.count({ where: { vehicleId, deletedAt: null } }),
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
  const email = `veh-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('LifecycleTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Lifecycle' } },
    },
  })
  userIds.push(user.id)
  const ws = await prisma.workspace.create({
    data: {
      name: 'Lifecycle garage',
      slug: `veh-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(ws.id)
  workspaceId = ws.id

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
  await prisma.reminder.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.notification.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
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

describe('selling a vehicle', () => {
  it('KEEPS every record — that is most of why someone kept it', async () => {
    const id = await vehicleWithHistory('Sold')
    const before = await historyOf(id)

    const res = await api(`/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SOLD', reason: 'Sold to a dealer' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('SOLD')

    expect(await historyOf(id)).toEqual(before)
    expect(before.services).toBe(1)
    expect(before.fuel).toBe(1)
  })

  it('removes it from the garage view but keeps it reachable', async () => {
    const id = await vehicleWithHistory('Hidden')
    await api(`/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SOLD' }),
    })

    const listed = (await (await api('/vehicles')).json()).data
    expect(listed.some((v: { id: string }) => v.id === id)).toBe(false)

    // Still openable: its history is the point.
    expect((await api(`/vehicles/${id}`)).status).toBe(200)

    const withInactive = (await (await api('/vehicles?includeInactive=true')).json()).data
    expect(withInactive.some((v: { id: string }) => v.id === id)).toBe(true)
  })

  it('records the reason on the audit trail', async () => {
    const id = await vehicleWithHistory('Audited')
    await api(`/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SCRAPPED', reason: 'Written off after a collision' }),
    })
    const row = await prisma.auditLog.findFirst({
      where: { resourceId: id, action: 'vehicle.status_changed' },
    })
    expect(JSON.stringify(row!.metadata)).toContain('Written off')
    expect(JSON.stringify(row!.metadata)).toContain('SCRAPPED')
  })

  it('cancels reminders so a sold car stops asking for an MOT', async () => {
    const id = await vehicleWithHistory('Reminded')
    const reminder = await prisma.reminder.create({
      data: {
        workspaceId,
        vehicleId: id,
        sourceType: 'INSPECTION',
        sourceId: id,
        title: 'MOT expires soon',
        status: 'DUE',
      },
    })

    await api(`/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'SOLD' }),
    })
    const after = await prisma.reminder.findUnique({ where: { id: reminder.id } })
    expect(after!.status).toBe('CANCELLED')
  })

  it('accepts every status in the lifecycle', async () => {
    const id = await vehicleWithHistory('Cycled')
    for (const status of ['STORED', 'ARCHIVED', 'SOLD', 'SCRAPPED', 'ACTIVE'] as const) {
      const res = await api(`/vehicles/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      expect(res.status, status).toBe(200)
    }
  })

  it('refuses a status that is not part of the lifecycle', async () => {
    const id = await vehicleWithHistory('Invalid')
    const res = await api(`/vehicles/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DESTROYED' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('deleting a vehicle', () => {
  it('hides it without destroying anything', async () => {
    const id = await vehicleWithHistory('Deleted')
    const before = await historyOf(id)

    expect((await api(`/vehicles/${id}`, { method: 'DELETE' })).status).toBe(204)

    // The row survives — a user action never removes a vehicle outright.
    const row = await prisma.vehicle.findUnique({ where: { id } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()

    // And so does every record behind it.
    expect(await historyOf(id)).toEqual(before)
  })

  it('disappears from reads, including with includeInactive', async () => {
    const id = await vehicleWithHistory('Gone')
    await api(`/vehicles/${id}`, { method: 'DELETE' })

    expect((await api(`/vehicles/${id}`)).status).toBe(404)
    const all = (await (await api('/vehicles?includeInactive=true')).json()).data
    expect(all.some((v: { id: string }) => v.id === id)).toBe(false)
  })

  it('takes its costs out of the reports with it', async () => {
    const id = await vehicleWithHistory('Costly')
    const before = (await (await api('/reports/costs?from=2026-01-01&to=2026-12-31')).json()).data

    await api(`/vehicles/${id}`, { method: 'DELETE' })
    const after = (await (await api('/reports/costs?from=2026-01-01&to=2026-12-31')).json()).data

    // 450 + 70 leaves the totals: a vehicle entered in error must not keep inflating them.
    expect(Number(before.total) - Number(after.total)).toBeCloseTo(520, 2)
  })

  it('can be found again and restored, with its history intact', async () => {
    const id = await vehicleWithHistory('Restored')
    const before = await historyOf(id)
    await api(`/vehicles/${id}`, { method: 'DELETE' })

    const deleted = (await (await api('/vehicles/deleted')).json()).data
    expect(deleted.some((v: { id: string }) => v.id === id)).toBe(true)

    const res = await api(`/vehicles/${id}/restore`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect((await api(`/vehicles/${id}`)).status).toBe(200)
    expect(await historyOf(id)).toEqual(before)
  })

  it('refuses to restore one that was never deleted', async () => {
    const id = await vehicleWithHistory('Present')
    expect((await api(`/vehicles/${id}/restore`, { method: 'POST' })).status).toBe(404)
  })

  it('explains itself when the plate was taken while the vehicle was hidden', async () => {
    // The uniqueness index is partial on `deleted_at IS NULL`, so deleting a vehicle frees
    // its registration. Reusing it and then restoring the original would put two live rows
    // on one plate; Postgres refuses either way, and the user is owed a reason rather than
    // a 500.
    const plate = `RE ${Math.floor(Math.random() * 9000 + 1000)}`
    const first = (
      await (
        await api('/vehicles', {
          method: 'POST',
          body: JSON.stringify({
            manufacturer: 'Lifecycle',
            model: 'Reused',
            registrationNumber: plate,
            distanceUnit: 'KILOMETERS',
          }),
        })
      ).json()
    ).data

    expect((await api(`/vehicles/${first.id}`, { method: 'DELETE' })).status).toBe(204)

    // The plate is free again — that is the point of a partial index.
    const second = await api('/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        manufacturer: 'Lifecycle',
        model: 'Successor',
        registrationNumber: plate,
        distanceUnit: 'KILOMETERS',
      }),
    })
    expect(second.status).toBe(201)

    const restore = await api(`/vehicles/${first.id}/restore`, { method: 'POST' })
    expect(restore.status).toBe(409)
    expect((await restore.json()).error.code).toBe('REGISTRATION_REUSED')

    // And it stays deleted rather than half-restored.
    expect((await api(`/vehicles/${first.id}`)).status).toBe(404)
  })

  it('cancels open reminders on deletion', async () => {
    const id = await vehicleWithHistory('Quiet')
    const reminder = await prisma.reminder.create({
      data: {
        workspaceId,
        vehicleId: id,
        sourceType: 'MAINTENANCE',
        sourceId: id,
        title: 'Service due',
        status: 'DUE',
      },
    })
    await api(`/vehicles/${id}`, { method: 'DELETE' })
    const after = await prisma.reminder.findUnique({ where: { id: reminder.id } })
    expect(after!.status).toBe('CANCELLED')
  })
})

describe('permissions', () => {
  it('refuses an EDITOR deleting a vehicle', async () => {
    const id = await vehicleWithHistory('Protected')
    const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const editor = await prisma.user.create({
      data: {
        email: `veh-editor-${unique}@example.com`,
        passwordHash: await hashPassword('LifecycleTest123!'),
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: 'Editor' } },
      },
    })
    userIds.push(editor.id)
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: editor.id,
        role: 'EDITOR',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    })
    const login = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: editor.email }),
    })
    const editorCookie = (
      login.headers.getSetCookie?.()[0] ??
      login.headers.get('set-cookie') ??
      ''
    ).split(';')[0]!

    // vehicle:delete is OWNER and ADMIN only.
    const remove = await fetch(`${baseUrl}/api/v1/workspaces/${workspaceId}/vehicles/${id}`, {
      method: 'DELETE',
      headers: { cookie: editorCookie },
    })
    expect(remove.status).toBe(403)

    // But an EDITOR may change the status: selling a car is ordinary bookkeeping.
    const status = await fetch(
      `${baseUrl}/api/v1/workspaces/${workspaceId}/vehicles/${id}/status`,
      {
        method: 'PATCH',
        headers: { cookie: editorCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'STORED' }),
      },
    )
    expect(status.status).toBe(200)
  })
})
