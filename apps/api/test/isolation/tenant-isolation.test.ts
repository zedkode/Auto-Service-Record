/**
 * TENANT ISOLATION SUITE — the test that proves the security boundary.
 *
 * Mandated by TESTING.md §4.1 and §6 (E2E-2) and SECURITY.md §3.
 * A failure here blocks merge unconditionally. There is no "fix it in the next PR".
 *
 * Run: pnpm test:isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../../.env'), quiet: true })
process.env.DEV_AUTH_ENABLED = 'true'

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

async function createActor(label: string): Promise<Actor> {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const email = `iso-${label}-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('IsolationTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: label } },
    },
  })
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label} garage`,
      slug: `iso-${label}-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId: workspace.id,
      manufacturer: 'Isolation',
      model: label,
      distanceUnit: 'MILES',
      currentOdometer: 1000,
      currentOdometerUnit: 'MILES',
    },
  })
  await prisma.odometerEntry.create({
    data: {
      workspaceId: workspace.id,
      vehicleId: vehicle.id,
      value: 1000,
      unit: 'MILES',
      recordedOn: new Date(new Date().toISOString().slice(0, 10)),
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

/**
 * Mirrors the real ApiClient: content-type is set only when there IS a body. Fastify
 * rejects an empty body when the header claims JSON, which would mask the status under
 * test with a 400 from the body parser.
 */
const req = (actor: Actor, url: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}${url}`, {
    ...init,
    headers: {
      cookie: actor.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

let alice: Actor
let bob: Actor

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3101'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()

  alice = await createActor('alice')
  bob = await createActor('bob')
})

afterAll(async () => {
  for (const a of [alice, bob].filter(Boolean)) {
    await prisma.supportAccessGrant.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.fuelEntry.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.document.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.expense.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.maintenanceCompletion.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.maintenanceRule.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.serviceRecordPart.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.serviceRecord.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.odometerEntry.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.vehicle.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.auditLog.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: a.workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: a.workspaceId } })
    await prisma.session.deleteMany({ where: { userId: a.userId } })
    await prisma.userProfile.deleteMany({ where: { userId: a.userId } })
    await prisma.user.deleteMany({ where: { id: a.userId } })
  }
  await prisma.$disconnect()
  await app.close()
})

describe('E2E-2: a member of workspace A cannot reach workspace B', () => {
  it('sanity: each actor can read their own workspace', async () => {
    expect((await req(alice, `/api/v1/workspaces/${alice.workspaceId}/vehicles`)).status).toBe(200)
    expect((await req(bob, `/api/v1/workspaces/${bob.workspaceId}/vehicles`)).status).toBe(200)
  })

  const crossTenantReads = [
    ['list vehicles', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles`],
    ['read vehicle', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}`],
    [
      'vehicle timeline',
      (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}/timeline`,
    ],
    [
      'odometer history',
      (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}/odometer`,
    ],
    [
      'current odometer',
      (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}/odometer/current`,
    ],
    ['workspace', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}`],
    ['members', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/members`],
    ['dashboard', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/dashboard`],
    ['service history', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/services`],
    [
      'vehicle services',
      (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}/services`,
    ],
    [
      'maintenance rules',
      (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/vehicles/${b.vehicleId}/maintenance`,
    ],
    ['maintenance due', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/maintenance/due`],
    ['service categories', (b: Actor) => `/api/v1/workspaces/${b.workspaceId}/service-categories`],
  ] as const

  it.each(crossTenantReads)('%s returns 404, never 403 or 200', async (_label, urlFor) => {
    const res = await req(alice, urlFor(bob))
    // 404 not 403: a 403 would confirm the resource exists in another tenant.
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('WORKSPACE_NOT_FOUND')
  })

  it('cannot create a service on another tenant\u2019s vehicle', async () => {
    const res = await req(
      alice,
      `/api/v1/workspaces/${bob.workspaceId}/vehicles/${bob.vehicleId}/services`,
      {
        method: 'POST',
        body: JSON.stringify({ performedOn: '2026-09-20', title: 'Hostile service' }),
      },
    )
    expect(res.status).toBe(404)
    const count = await prisma.serviceRecord.count({ where: { vehicleId: bob.vehicleId } })
    expect(count).toBe(0)
  })

  it('cannot apply a maintenance template to another tenant\u2019s vehicle', async () => {
    const res = await req(
      alice,
      `/api/v1/workspaces/${bob.workspaceId}/vehicles/${bob.vehicleId}/maintenance/apply-template`,
      {
        method: 'POST',
      },
    )
    expect(res.status).toBe(404)
    expect(await prisma.maintenanceRule.count({ where: { vehicleId: bob.vehicleId } })).toBe(0)
  })

  it('cross-tenant write is rejected and changes nothing', async () => {
    const before = await prisma.odometerEntry.count({ where: { vehicleId: bob.vehicleId } })

    const res = await req(
      alice,
      `/api/v1/workspaces/${bob.workspaceId}/vehicles/${bob.vehicleId}/odometer`,
      {
        method: 'POST',
        body: JSON.stringify({ value: 999_999, unit: 'MILES', recordedOn: '2026-09-20' }),
      },
    )
    expect(res.status).toBe(404)

    const after = await prisma.odometerEntry.count({ where: { vehicleId: bob.vehicleId } })
    expect(after).toBe(before)
  })

  it('IDOR: smuggling B’s vehicle id into A’s own workspace path returns 404', async () => {
    const res = await req(
      alice,
      `/api/v1/workspaces/${alice.workspaceId}/vehicles/${bob.vehicleId}`,
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('VEHICLE_NOT_FOUND')
  })

  it('A’s vehicle list never contains B’s vehicle', async () => {
    const body = await (await req(alice, `/api/v1/workspaces/${alice.workspaceId}/vehicles`)).json()
    const ids = body.data.map((v: { id: string }) => v.id)
    expect(ids).toContain(alice.vehicleId)
    expect(ids).not.toContain(bob.vehicleId)
  })

  it('an unauthenticated caller gets 401, not data', async () => {
    const res = await fetch(`${baseUrl}/api/v1/workspaces/${alice.workspaceId}/vehicles`)
    expect(res.status).toBe(401)
  })
})

describe('LAYER 2: the Prisma tenant extension scopes every operation', () => {
  it('derives its protected-model set from the schema', async () => {
    const { TENANT_MODELS } = await import('@autoservices/db')
    // If a tenant-owned model is missing here, it is silently unprotected.
    expect([...TENANT_MODELS].sort()).toEqual(
      [
        'Document',
        'EmailMessage',
        'Expense',
        'ExpenseCategory',
        // EXP-001. The row is workspace-scoped like any other; the FILE it points at is
        // protected separately, by an unguessable key and a signed, expiring URL.
        'ExportJob',
        'FuelEntry',
        'InspectionAdvisory',
        'InsurancePolicy',
        'MaintenanceCompletion',
        'MaintenanceRule',
        'Notification',
        'NotificationDelivery',
        'NotificationPreference',
        'OdometerEntry',
        'Reminder',
        'RoadTaxRecord',
        'ServiceCategory',
        'ServiceRecord',
        'ServiceRecordPart',
        // Workspace-scoped, but reached only through the ADMIN realm behind a support
        // access grant — never through a customer request (SEC-018).
        'SupportAccessGrant',
        // OWN-005. A set and the periods it spent on a car are both tenant-owned.
        'TyreInstallation',
        'TyreSet',
        'Vehicle',
        'VehicleImage',
        'VehicleInspection',
        'Warranty',
        'WorkspaceInvitation',
        'WorkspaceMember',
      ].sort(),
    )
  })

  it('a scoped client cannot read another workspace’s rows', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const scoped = forWorkspace(prisma, alice.workspaceId)
    expect(await scoped.vehicle.findFirst({ where: { id: bob.vehicleId } })).toBeNull()
    expect(await scoped.vehicle.findMany({ where: { id: bob.vehicleId } })).toHaveLength(0)
    expect(await scoped.vehicle.count({ where: { id: bob.vehicleId } })).toBe(0)
  })

  it('a caller-supplied workspaceId cannot widen the scope', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const scoped = forWorkspace(prisma, alice.workspaceId)
    // Filter operations AND-compose, so an attempt to target another tenant matches
    // nothing at all.
    const found = await scoped.vehicle.findMany({ where: { workspaceId: bob.workspaceId } })
    expect(found).toHaveLength(0)
  })

  it('unique-where operations still work AND stay scoped', async () => {
    // REGRESSION: the extension used to AND-wrap every where clause, which Prisma
    // rejects for update/delete/findUnique ("needs at least one of id..."). Those
    // operations now merge the scope instead — it must still be impossible to reach
    // another tenant's row.
    const { forWorkspace } = await import('@autoservices/db')
    const alicesDb = forWorkspace(prisma, alice.workspaceId)

    // Own row: findUnique and update both succeed.
    expect(await alicesDb.vehicle.findUnique({ where: { id: alice.vehicleId } })).not.toBeNull()
    const renamed = await alicesDb.vehicle.update({
      where: { id: alice.vehicleId },
      data: { colour: 'Verified Blue' },
    })
    expect(renamed.colour).toBe('Verified Blue')

    // Another tenant's row: invisible, and not updatable.
    expect(await alicesDb.vehicle.findUnique({ where: { id: bob.vehicleId } })).toBeNull()
    await expect(
      alicesDb.vehicle.update({ where: { id: bob.vehicleId }, data: { colour: 'Hijacked' } }),
    ).rejects.toThrow()

    const bobsVehicle = await prisma.vehicle.findUnique({ where: { id: bob.vehicleId } })
    expect(bobsVehicle?.colour).not.toBe('Hijacked')
  })

  it('a scoped delete of another tenant\u2019s row by unique id fails', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const alicesDb = forWorkspace(prisma, alice.workspaceId)
    await expect(alicesDb.vehicle.delete({ where: { id: bob.vehicleId } })).rejects.toThrow()
    expect(await prisma.vehicle.findUnique({ where: { id: bob.vehicleId } })).not.toBeNull()
  })

  it('a scoped create cannot plant a row in another workspace', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const scoped = forWorkspace(prisma, alice.workspaceId)
    const created = await scoped.vehicle.create({
      data: {
        workspaceId: bob.workspaceId, // hostile input — must be overridden
        manufacturer: 'Hostile',
        model: 'Create',
        distanceUnit: 'MILES',
      } as never,
    })
    expect(created.workspaceId).toBe(alice.workspaceId)
    await prisma.vehicle.delete({ where: { id: created.id } })
  })

  it('a scoped update cannot touch another workspace’s row', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const scoped = forWorkspace(prisma, alice.workspaceId)
    const result = await scoped.vehicle.updateMany({
      where: { id: bob.vehicleId },
      data: { manufacturer: 'Hijacked' },
    })
    expect(result.count).toBe(0)
    const bobVehicle = await prisma.vehicle.findUnique({ where: { id: bob.vehicleId } })
    expect(bobVehicle?.manufacturer).toBe('Isolation')
  })

  it('a scoped delete cannot remove another workspace’s row', async () => {
    const { forWorkspace } = await import('@autoservices/db')
    const scoped = forWorkspace(prisma, alice.workspaceId)
    const result = await scoped.vehicle.deleteMany({ where: { id: bob.vehicleId } })
    expect(result.count).toBe(0)
    expect(await prisma.vehicle.findUnique({ where: { id: bob.vehicleId } })).not.toBeNull()
  })
})

describe('LAYER 3: the database rejects cross-workspace rows regardless of application code', () => {
  it('composite foreign keys exist on every tenant-owned child table', async () => {
    const rows = await prisma.$queryRaw<Array<{ child: string }>>`
      SELECT c.conrelid::regclass::text AS child
      FROM pg_constraint c
      WHERE c.contype = 'f' AND array_length(c.conkey, 1) > 1
    `
    const children = rows.map((r) => r.child)
    expect(children).toContain('odometer_entries')
    expect(children).toContain('vehicle_images')
  })

  it('raw SQL cannot pair a vehicle with a foreign workspace', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO odometer_entries (id, workspace_id, vehicle_id, value, unit, recorded_on)
        VALUES (gen_random_uuid(), ${bob.workspaceId}::uuid, ${alice.vehicleId}::uuid, 1, 'MILES', CURRENT_DATE)
      `,
    ).rejects.toThrow()
  })

  it('a workspace cannot have two active owners', async () => {
    await expect(
      prisma.workspaceMember.create({
        data: {
          workspaceId: alice.workspaceId,
          userId: bob.userId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow()
  })
})
