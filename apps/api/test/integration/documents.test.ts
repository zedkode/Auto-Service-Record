/**
 * DOC-101…104/106 — the document vault, against real object storage.
 *
 * These assert the security properties, not the happy path alone: a file that is not what
 * it claimed is quarantined rather than served, one tenant cannot reach another's
 * documents, and nothing is downloadable until it has been verified.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import 'reflect-metadata'
import path from 'node:path'
import { createHash } from 'node:crypto'
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
const userIds: string[] = []
const workspaceIds: string[] = []

const PDF = Buffer.from('%PDF-1.7\nfake but correctly shaped pdf for testing\n%%EOF\n')
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function createActor(label: string): Promise<Actor> {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  const email = `doc-${label}-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('DocumentTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: label } },
    },
  })
  userIds.push(user.id)
  const workspace = await prisma.workspace.create({
    data: {
      name: `${label} garage`,
      slug: `doc-${label}-${unique}`,
      type: 'PERSONAL',
      ownerUserId: user.id,
      members: {
        create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      },
    },
  })
  workspaceIds.push(workspace.id)
  const vehicle = await prisma.vehicle.create({
    data: {
      workspaceId: workspace.id,
      manufacturer: 'Document',
      model: label,
      distanceUnit: 'MILES',
    },
  })
  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  return {
    cookie: (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(';')[0]!,
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

/** Runs the whole upload dance and returns the document id. */
async function upload(
  actor: Actor,
  body: Buffer,
  over: Record<string, unknown> = {},
): Promise<{ documentId: string; finalise: Response }> {
  const session = await (
    await api(actor, '/documents/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        byteSize: body.byteLength,
        checksumSha256: sha256(body),
        vehicleId: actor.vehicleId,
        documentType: 'INVOICE',
        ...over,
      }),
    })
  ).json()

  const put = await fetch(session.data.upload.url, {
    method: 'PUT',
    headers: session.data.upload.headers,
    body: new Uint8Array(body),
  })
  if (!put.ok) throw new Error(`presigned PUT failed: ${put.status} ${await put.text()}`)

  const finalise = await api(actor, `/documents/${session.data.documentId}/finalise`, {
    method: 'POST',
  })
  return { documentId: session.data.documentId, finalise }
}

let owner: Actor
let other: Actor

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
}, 60_000)

afterAll(async () => {
  await prisma.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.expense.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
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

describe('upload, finalise, download', () => {
  it('completes the round trip and returns the bytes that went in', async () => {
    const { documentId, finalise } = await upload(owner, PDF)
    expect(finalise.status).toBe(201)
    expect((await finalise.json()).data.status).toBe('AVAILABLE')

    const dl = await (await api(owner, `/documents/${documentId}/download`)).json()
    expect(dl.data.expiresInSeconds).toBe(300)

    const fetched = await fetch(dl.data.url)
    expect(fetched.status).toBe(200)
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF)).toBe(true)
    // Forces a download and restores the original name.
    expect(fetched.headers.get('content-disposition')).toContain('attachment')
    expect(fetched.headers.get('content-disposition')).toContain('invoice.pdf')
  })

  it('does not put the filename in the object key', async () => {
    const { documentId } = await upload(owner, PDF, { filename: 'my-secret-invoice.pdf' })
    const row = await prisma.document.findUnique({ where: { id: documentId } })
    expect(row!.storageKey).not.toMatch(/secret/i)
    expect(row!.storageKey).toMatch(
      new RegExp(`^workspaces/${owner.workspaceId}/\\d{4}/\\d{2}/[0-9a-f-]+\\.pdf$`),
    )
  })

  it('records the scan as SKIPPED, not CLEAN — there is no scanner', async () => {
    const { documentId } = await upload(owner, PDF)
    const row = await prisma.document.findUnique({ where: { id: documentId } })
    expect(row!.scanStatus).toBe('SKIPPED')
  })
})

describe('what may be uploaded', () => {
  it('refuses SVG', async () => {
    const res = await api(owner, '/documents/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'logo.svg',
        contentType: 'image/svg+xml',
        byteSize: 100,
        checksumSha256: sha256(Buffer.from('x')),
      }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses a type and extension that disagree', async () => {
    const res = await api(owner, '/documents/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'payload.exe',
        contentType: 'application/pdf',
        byteSize: 100,
        checksumSha256: sha256(Buffer.from('x')),
      }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses a file over the size cap', async () => {
    const res = await api(owner, '/documents/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'huge.pdf',
        contentType: 'application/pdf',
        byteSize: 21 * 1024 * 1024,
        checksumSha256: sha256(Buffer.from('x')),
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('the bytes are verified, not trusted', () => {
  it('QUARANTINES a file that is not what it claimed to be', async () => {
    // Declared as a PDF, actually HTML — the stored-XSS attempt this check exists for.
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    const { documentId, finalise } = await upload(owner, html)
    expect(finalise.status).toBe(422)

    const row = await prisma.document.findUnique({ where: { id: documentId } })
    expect(row!.status).toBe('QUARANTINED')

    // And a quarantined document is never served, to anyone.
    const dl = await api(owner, `/documents/${documentId}/download`)
    expect(dl.status).toBe(404)
  })

  it('QUARANTINES a file whose checksum does not match', async () => {
    const session = await (
      await api(owner, '/documents/upload-session', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          byteSize: PDF.byteLength,
          // A checksum for entirely different content.
          checksumSha256: sha256(Buffer.from('something else')),
        }),
      })
    ).json()
    await fetch(session.data.upload.url, {
      method: 'PUT',
      headers: session.data.upload.headers,
      body: new Uint8Array(PDF),
    })
    const finalise = await api(owner, `/documents/${session.data.documentId}/finalise`, {
      method: 'POST',
    })
    expect(finalise.status).toBe(422)
    const row = await prisma.document.findUnique({ where: { id: session.data.documentId } })
    expect(row!.status).toBe('QUARANTINED')
  })

  it('refuses to finalise when nothing was uploaded', async () => {
    const session = await (
      await api(owner, '/documents/upload-session', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'never-sent.pdf',
          contentType: 'application/pdf',
          byteSize: 10,
          checksumSha256: sha256(Buffer.from('x')),
        }),
      })
    ).json()
    const res = await api(owner, `/documents/${session.data.documentId}/finalise`, {
      method: 'POST',
    })
    expect(res.status).toBe(422)
  })
})

describe('nothing is servable before it is verified', () => {
  it('refuses to download a PENDING document', async () => {
    const session = await (
      await api(owner, '/documents/upload-session', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'pending.pdf',
          contentType: 'application/pdf',
          byteSize: PDF.byteLength,
          checksumSha256: sha256(PDF),
        }),
      })
    ).json()
    const res = await api(owner, `/documents/${session.data.documentId}/download`)
    expect(res.status).toBe(404)
  })

  it('hides PENDING and QUARANTINED rows from the list', async () => {
    const list = await (await api(owner, '/documents')).json()
    expect(list.data.every((d: { status: string }) => d.status === 'AVAILABLE')).toBe(true)
  })
})

describe('tenant isolation', () => {
  it('will not issue a download URL for another workspace’s document', async () => {
    const { documentId } = await upload(owner, PDF)
    const res = await fetch(
      `${baseUrl}/api/v1/workspaces/${other.workspaceId}/documents/${documentId}/download`,
      { headers: { cookie: other.cookie } },
    )
    // 404, not 403: the existence of another tenant's document is not ours to confirm.
    expect(res.status).toBe(404)
  })

  it('does not list another workspace’s documents', async () => {
    const list = await (await api(other, '/documents')).json()
    expect(list.data).toHaveLength(0)
  })

  it('refuses to attach to a record in another workspace', async () => {
    const res = await api(owner, '/documents/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        byteSize: 10,
        checksumSha256: sha256(Buffer.from('x')),
        attachedToType: 'VEHICLE',
        attachedToId: other.vehicleId,
      }),
    })
    expect(res.status).toBe(404)
  })
})

describe('deletion', () => {
  it('soft-deletes so an accident is recoverable', async () => {
    const { documentId } = await upload(owner, PDF)
    const res = await api(owner, `/documents/${documentId}`, { method: 'DELETE' })
    expect(res.status).toBe(204)

    const row = await prisma.document.findUnique({ where: { id: documentId } })
    expect(row).not.toBeNull()
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.status).toBe('DELETED')

    expect((await api(owner, `/documents/${documentId}/download`)).status).toBe(404)
  })
})
