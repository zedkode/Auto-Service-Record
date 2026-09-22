/**
 * EXP-001 — the API half of the export pipeline.
 *
 * The worker's half is covered end to end by `scripts/verify-exports.mjs`, which runs the
 * real queue against real object storage. What matters here is everything the API decides
 * before a job exists: who may ask, what may be asked for, and what a caller is told when
 * the answer is no.
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

const request = (body: Record<string, unknown>) =>
  api('/exports', { method: 'POST', body: JSON.stringify(body) })

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
  const email = `exp-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('ExportTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: 'Export' } },
    },
  })
  userIds.push(user.id)
  const ws = await prisma.workspace.create({
    data: {
      name: 'Export garage',
      slug: `exp-${unique}`,
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

  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId,
      manufacturer: 'Export',
      model: 'Test',
      distanceUnit: 'MILES',
      status: 'ACTIVE',
    },
  })
  vehicleId = vehicle.id
}, 60_000)

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.exportJob.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.vehicle.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('requesting an export', () => {
  it('accepts and returns immediately rather than building inline', async () => {
    const res = await request({ kind: 'EXPENSES', format: 'CSV' })
    expect(res.status).toBe(202)
    const job = (await res.json()).data
    // PENDING, with no file: the point of the whole design is that the request does not
    // wait for one.
    expect(job.status).toBe('PENDING')
    expect(job.filename).toBeNull()
    expect(job.byteSize).toBeNull()
    await prisma.exportJob.delete({ where: { id: job.id } })
  })

  it('records the filters it was given, and only the ones that apply', async () => {
    const dated = (
      await (
        await request({ kind: 'FUEL', format: 'CSV', from: '2026-01-01', to: '2026-06-30' })
      ).json()
    ).data
    expect(dated.params).toEqual({ from: '2026-01-01', to: '2026-06-30' })

    // A vehicle list has no date to filter on, so storing one would describe a file that
    // does not exist.
    const undated = (
      await (
        await request({ kind: 'VEHICLES', format: 'CSV', from: '2026-01-01', to: '2026-06-30' })
      ).json()
    ).data
    expect(undated.params).toEqual({})

    await prisma.exportJob.deleteMany({ where: { id: { in: [dated.id, undated.id] } } })
  })

  it('refuses a kind or format it cannot build', async () => {
    // Accepting these would queue a job that fails after the user was told it was accepted.
    expect((await request({ kind: 'EVERYTHING', format: 'CSV' })).status).toBe(422)
    expect((await request({ kind: 'EXPENSES', format: 'PDF' })).status).toBe(422)
  })

  it('refuses a backwards date range', async () => {
    const res = await request({
      kind: 'EXPENSES',
      format: 'CSV',
      from: '2026-12-31',
      to: '2026-01-01',
    })
    expect(res.status).toBe(422)
  })

  it('refuses a vehicle from another workspace', async () => {
    const other = await prisma.workspace.findFirst({ where: { id: { notIn: workspaceIds } } })
    const foreign = other
      ? await prisma.vehicle.findFirst({ where: { workspaceId: other.id } })
      : null
    if (!foreign) return
    const res = await request({ kind: 'FUEL', format: 'CSV', vehicleId: foreign.id })
    // 404, not 403: a non-member is never told the vehicle exists.
    expect(res.status).toBe(404)
  })

  it('accepts a vehicle from this workspace', async () => {
    const res = await request({ kind: 'FUEL', format: 'CSV', vehicleId })
    expect(res.status).toBe(202)
    const job = (await res.json()).data
    expect(job.params.vehicleId).toBe(vehicleId)
    await prisma.exportJob.delete({ where: { id: job.id } })
  })

  it('caps how many can be queued at once', async () => {
    /**
     * The PENDING rows are written directly rather than requested through the API. A
     * worker is running against the same Redis in development and drains the queue faster
     * than this test can fill it, so requesting them would leave nothing pending and the
     * assertion would pass or fail depending on machine speed.
     */
    await prisma.exportJob.createMany({
      data: Array.from({ length: 3 }, () => ({
        workspaceId,
        kind: 'VEHICLES' as const,
        format: 'CSV' as const,
        status: 'PENDING' as const,
      })),
    })
    try {
      // One workspace must not be able to fill the queue for everyone else.
      const refused = await request({ kind: 'VEHICLES', format: 'CSV' })
      expect(refused.status).toBe(409)
      expect((await refused.json()).error.message).toMatch(/being prepared/i)
    } finally {
      await prisma.exportJob.deleteMany({ where: { workspaceId, status: 'PENDING' } })
    }
  })

  it('allows another once the queued ones finish', async () => {
    await prisma.exportJob.createMany({
      data: Array.from({ length: 3 }, () => ({
        workspaceId,
        kind: 'VEHICLES' as const,
        format: 'CSV' as const,
        // READY and FAILED are finished work and must not count against the cap.
        status: 'READY' as const,
      })),
    })
    try {
      const res = await request({ kind: 'VEHICLES', format: 'CSV' })
      expect(res.status).toBe(202)
      await prisma.exportJob.delete({ where: { id: (await res.json()).data.id } })
    } finally {
      await prisma.exportJob.deleteMany({ where: { workspaceId, status: 'READY' } })
    }
  })

  it('writes an audit entry naming what was asked for', async () => {
    const job = (await (await request({ kind: 'SERVICES', format: 'JSON' })).json()).data
    const row = await prisma.auditLog.findFirst({
      where: { resourceId: job.id, action: 'export.requested' },
    })
    expect(row).not.toBeNull()
    expect(JSON.stringify(row!.metadata)).toContain('SERVICES')
    await prisma.exportJob.delete({ where: { id: job.id } })
  })
})

describe('downloading an export', () => {
  it('refuses to issue a link for one that is not built yet', async () => {
    const job = (await (await request({ kind: 'EXPENSES', format: 'CSV' })).json()).data
    const res = await api(`/exports/${job.id}/download`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toMatch(/not ready/i)
    await prisma.exportJob.delete({ where: { id: job.id } })
  })

  it('explains a failed export rather than offering a broken link', async () => {
    const job = (await (await request({ kind: 'EXPENSES', format: 'CSV' })).json()).data
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: 'The export could not be built.' },
    })
    const res = await api(`/exports/${job.id}/download`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toMatch(/could not be built/i)
    await prisma.exportJob.delete({ where: { id: job.id } })
  })

  it('marks an expired export rather than signing a URL for a reaped file', async () => {
    const job = (await (await request({ kind: 'EXPENSES', format: 'CSV' })).json()).data
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'READY',
        objectKey: 'exports/none',
        filename: 'x.csv',
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    })
    const res = await api(`/exports/${job.id}/download`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await prisma.exportJob.findUnique({ where: { id: job.id } }))!.status).toBe('EXPIRED')
    await prisma.exportJob.delete({ where: { id: job.id } })
  })

  it('404s for an export id that does not exist', async () => {
    const res = await api('/exports/01a0bf92-0000-7000-8000-000000000000/download', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })
})

describe('who may export', () => {
  it('lets a VIEWER read the list but not create one', async () => {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId } })
    await prisma.workspaceMember.update({ where: { id: member!.id }, data: { role: 'VIEWER' } })
    try {
      // Reading on screen and taking the whole workspace away as a file are different acts.
      expect((await api('/exports')).status).toBe(200)
      expect((await request({ kind: 'VEHICLES', format: 'CSV' })).status).toBe(403)
    } finally {
      await prisma.workspaceMember.update({ where: { id: member!.id }, data: { role: 'OWNER' } })
    }
  })

  it('lets an EDITOR create one', async () => {
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId } })
    await prisma.workspaceMember.update({ where: { id: member!.id }, data: { role: 'EDITOR' } })
    try {
      const res = await request({ kind: 'VEHICLES', format: 'CSV' })
      expect(res.status).toBe(202)
      await prisma.exportJob.delete({ where: { id: (await res.json()).data.id } })
    } finally {
      await prisma.workspaceMember.update({ where: { id: member!.id }, data: { role: 'OWNER' } })
    }
  })
})
