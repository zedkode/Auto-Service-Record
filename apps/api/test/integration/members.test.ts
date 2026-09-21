/**
 * WS-002/003/004 — membership, roles, ownership transfer and invitations.
 *
 * The interesting assertions are the invariants the database enforces: exactly one ACTIVE
 * OWNER even under a concurrent double transfer, an ADMIN who cannot touch the OWNER, and
 * a workspace that can never be left without a member.
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

const userIds: string[] = []
const workspaceIds: string[] = []

interface Person {
  id: string
  email: string
  cookie: string
}

async function person(label: string): Promise<Person> {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const email = `mem-${label}-${unique}@example.com`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword('MembersTest123!'),
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      profile: { create: { displayName: label } },
    },
  })
  userIds.push(user.id)
  const res = await fetch(`${baseUrl}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]!
  return { id: user.id, email, cookie }
}

/** A workspace owned by `owner`, with the given people added at the given roles. */
async function workspace(owner: Person, others: Array<[Person, string]> = []) {
  const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const ws = await prisma.workspace.create({
    data: {
      name: 'Members garage',
      slug: `mem-${unique}`,
      type: 'FAMILY',
      ownerUserId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
          ...others.map(([p, role]) => ({
            userId: p.id,
            role: role as never,
            status: 'ACTIVE' as const,
            joinedAt: new Date(),
          })),
        ],
      },
    },
  })
  workspaceIds.push(ws.id)
  return ws.id
}

const api = (p: Person, wsId: string, pathname: string, init: RequestInit = {}) =>
  fetch(`${baseUrl}/api/v1/workspaces/${wsId}${pathname}`, {
    ...init,
    headers: {
      cookie: p.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

const memberIdOf = async (wsId: string, userId: string) =>
  (await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId } }))!.id

beforeAll(async () => {
  app = await createApp({
    sessionSecret: process.env.SESSION_SECRET ?? 'test-secret-at-least-32-characters-long',
    corsOrigins: ['http://localhost:3101'],
    isProduction: false,
    logger: false,
  })
  await app.listen(0, '127.0.0.1')
  baseUrl = await app.getUrl()
}, 60_000)

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } })
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.$disconnect()
  await app.close()
})

describe('roles', () => {
  it('lets an OWNER change a member’s role', async () => {
    const owner = await person('owner')
    const member = await person('member')
    const ws = await workspace(owner, [[member, 'VIEWER']])

    const res = await api(owner, ws, `/members/${await memberIdOf(ws, member.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'EDITOR' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data.role).toBe('EDITOR')
  })

  it('REFUSES an ADMIN trying to change the OWNER’s role', async () => {
    const owner = await person('owner')
    const admin = await person('admin')
    const ws = await workspace(owner, [[admin, 'ADMIN']])

    const res = await api(admin, ws, `/members/${await memberIdOf(ws, owner.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'VIEWER' }),
    })
    expect(res.status).toBe(403)
  })

  it('REFUSES an ADMIN trying to remove the OWNER', async () => {
    const owner = await person('owner')
    const admin = await person('admin')
    const ws = await workspace(owner, [[admin, 'ADMIN']])

    const res = await api(admin, ws, `/members/${await memberIdOf(ws, owner.id)}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(403)
  })

  it('refuses anyone changing their own role', async () => {
    // Otherwise an ADMIN promotes themselves and the matrix means nothing.
    const owner = await person('owner')
    const admin = await person('admin')
    const ws = await workspace(owner, [[admin, 'ADMIN']])

    const res = await api(admin, ws, `/members/${await memberIdOf(ws, admin.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'OWNER' as never }),
    })
    expect([403, 422]).toContain(res.status)
  })

  it('refuses an EDITOR managing anyone', async () => {
    const owner = await person('owner')
    const editor = await person('editor')
    const viewer = await person('viewer')
    const ws = await workspace(owner, [
      [editor, 'EDITOR'],
      [viewer, 'VIEWER'],
    ])

    const res = await api(editor, ws, `/members/${await memberIdOf(ws, viewer.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'ADMIN' }),
    })
    expect(res.status).toBe(403)
  })

  it('cannot promote anyone to OWNER through the role endpoint', async () => {
    const owner = await person('owner')
    const member = await person('member')
    const ws = await workspace(owner, [[member, 'VIEWER']])

    const res = await api(owner, ws, `/members/${await memberIdOf(ws, member.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'OWNER' }),
    })
    // OWNER is not an assignable role; it is reached only by transfer.
    expect(res.status).toBe(422)
  })
})

describe('removal and leaving', () => {
  it('removes a member and revokes their access immediately', async () => {
    const owner = await person('owner')
    const member = await person('member')
    const ws = await workspace(owner, [[member, 'EDITOR']])

    expect((await api(member, ws, '/vehicles')).status).toBe(200)
    expect(
      (await api(owner, ws, `/members/${await memberIdOf(ws, member.id)}`, { method: 'DELETE' }))
        .status,
    ).toBe(204)
    // 404 rather than 403: they can no longer see that the workspace exists.
    expect((await api(member, ws, '/vehicles')).status).toBe(404)
  })

  it('lets a member leave on their own', async () => {
    const owner = await person('owner')
    const member = await person('member')
    const ws = await workspace(owner, [[member, 'VIEWER']])

    expect((await api(member, ws, '/members/leave', { method: 'POST' })).status).toBe(204)
    expect((await api(member, ws, '/vehicles')).status).toBe(404)
  })

  it('REFUSES the owner leaving — the workspace would have no owner', async () => {
    const owner = await person('owner')
    const ws = await workspace(owner)
    const res = await api(owner, ws, '/members/leave', { method: 'POST' })
    expect(res.status).toBe(422)
    expect((await res.json()).error.message).toMatch(/transfer ownership/i)
  })

  it('REFUSES removing the owner', async () => {
    const owner = await person('owner')
    const ws = await workspace(owner)
    const res = await api(owner, ws, `/members/${await memberIdOf(ws, owner.id)}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(422)
  })
})

describe('ownership transfer', () => {
  it('moves ownership atomically and demotes the previous owner', async () => {
    const owner = await person('owner')
    const heir = await person('heir')
    const ws = await workspace(owner, [[heir, 'ADMIN']])

    const res = await api(owner, ws, '/members/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify({ memberId: await memberIdOf(ws, heir.id), confirm: 'TRANSFER' }),
    })
    expect(res.status).toBe(201)

    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: ws } })
    const owners = members.filter((m) => m.role === 'OWNER')
    expect(owners).toHaveLength(1)
    expect(owners[0]!.userId).toBe(heir.id)
    expect(members.find((m) => m.userId === owner.id)!.role).toBe('ADMIN')

    // The denormalised pointer moved in the same transaction.
    const row = await prisma.workspace.findUnique({ where: { id: ws } })
    expect(row!.ownerUserId).toBe(heir.id)
  })

  it('requires the typed confirmation', async () => {
    const owner = await person('owner')
    const heir = await person('heir')
    const ws = await workspace(owner, [[heir, 'ADMIN']])

    const res = await api(owner, ws, '/members/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify({ memberId: await memberIdOf(ws, heir.id), confirm: 'yes' }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses an ADMIN transferring ownership', async () => {
    const owner = await person('owner')
    const admin = await person('admin')
    const other = await person('other')
    const ws = await workspace(owner, [
      [admin, 'ADMIN'],
      [other, 'VIEWER'],
    ])

    const res = await api(admin, ws, '/members/transfer-ownership', {
      method: 'POST',
      body: JSON.stringify({ memberId: await memberIdOf(ws, other.id), confirm: 'TRANSFER' }),
    })
    expect(res.status).toBe(403)
  })

  it('survives a concurrent double transfer with exactly one owner', async () => {
    // The partial unique index is the real guard here, not the application code.
    const owner = await person('owner')
    const a = await person('heir-a')
    const b = await person('heir-b')
    const ws = await workspace(owner, [
      [a, 'ADMIN'],
      [b, 'ADMIN'],
    ])

    const [ra, rb] = await Promise.all([
      api(owner, ws, '/members/transfer-ownership', {
        method: 'POST',
        body: JSON.stringify({ memberId: await memberIdOf(ws, a.id), confirm: 'TRANSFER' }),
      }),
      api(owner, ws, '/members/transfer-ownership', {
        method: 'POST',
        body: JSON.stringify({ memberId: await memberIdOf(ws, b.id), confirm: 'TRANSFER' }),
      }),
    ])

    const statuses = [ra.status, rb.status].sort()
    expect(statuses[0]).toBe(201)
    // The loser is refused, not silently ignored.
    expect(statuses[1]).toBeGreaterThanOrEqual(400)

    const owners = await prisma.workspaceMember.findMany({
      where: { workspaceId: ws, role: 'OWNER' },
    })
    expect(owners).toHaveLength(1)
  })
})

describe('invitations', () => {
  it('invites by email and stores only the token’s hash', async () => {
    const owner = await person('owner')
    const ws = await workspace(owner)

    const res = await api(owner, ws, '/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'invitee@example.com', role: 'EDITOR' }),
    })
    expect(res.status).toBe(201)
    const invitation = (await res.json()).data
    // The token never comes back in the response.
    expect(JSON.stringify(invitation)).not.toContain('token')

    const row = await prisma.workspaceInvitation.findUnique({ where: { id: invitation.id } })
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses inviting somebody who is already a member', async () => {
    const owner = await person('owner')
    const member = await person('member')
    const ws = await workspace(owner, [[member, 'VIEWER']])

    const res = await api(owner, ws, '/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: member.email, role: 'EDITOR' }),
    })
    expect(res.status).toBe(422)
  })

  it('refuses an EDITOR inviting anyone', async () => {
    const owner = await person('owner')
    const editor = await person('editor')
    const ws = await workspace(owner, [[editor, 'EDITOR']])

    const res = await api(editor, ws, '/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'someone@example.com', role: 'VIEWER' }),
    })
    expect(res.status).toBe(403)
  })

  it('supersedes a previous invitation to the same address', async () => {
    const owner = await person('owner')
    const ws = await workspace(owner)
    const body = JSON.stringify({ email: 'twice@example.com', role: 'VIEWER' })

    await api(owner, ws, '/invitations', { method: 'POST', body })
    await api(owner, ws, '/invitations', { method: 'POST', body })

    const live = await prisma.workspaceInvitation.findMany({
      where: { workspaceId: ws, email: 'twice@example.com', revokedAt: null },
    })
    expect(live).toHaveLength(1)
  })
})

describe('accepting an invitation', () => {
  /** Issues a real invitation and recovers the plaintext token the way the email would. */
  async function invite(owner: Person, ws: string, email: string, role = 'EDITOR') {
    const { randomBytes, createHash } = await import('node:crypto')
    const token = randomBytes(32).toString('base64url')
    const created = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: ws,
        email,
        role: role as never,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    })
    return { token, id: created.id }
  }

  it('previews without a session, naming only the workspace and role', async () => {
    const owner = await person('owner')
    const ws = await workspace(owner)
    const { token } = await invite(owner, ws, 'preview@example.com')

    const res = await fetch(`${baseUrl}/api/v1/invitations/preview?token=${token}`)
    expect(res.status).toBe(200)
    const data = (await res.json()).data
    expect(data.workspaceName).toBe('Members garage')
    expect(data.role).toBe('EDITOR')
  })

  it('joins the workspace and burns the token', async () => {
    const owner = await person('owner')
    const joiner = await person('joiner')
    const ws = await workspace(owner)
    const { token } = await invite(owner, ws, joiner.email)

    const res = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(201)

    // They are in, at the invited role, and can see the workspace.
    expect((await api(joiner, ws, '/vehicles')).status).toBe(200)
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: ws, userId: joiner.id },
    })
    expect(member!.role).toBe('EDITOR')

    // And the token is spent — refused exactly like an expired or forged one, so a
    // replay cannot be distinguished from a guess.
    const replay = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(replay.status).toBe(400)
    expect((await replay.json()).error.code).toBe('TOKEN_INVALID')
  })

  it('REFUSES a forwarded invitation opened by somebody else', async () => {
    // Otherwise forwarding the email is an access grant to whoever opens it first.
    const owner = await person('owner')
    const intended = await person('intended')
    const stranger = await person('stranger')
    const ws = await workspace(owner)
    const { token } = await invite(owner, ws, intended.email)

    const res = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: stranger.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(422)
    expect(
      await prisma.workspaceMember.findFirst({ where: { workspaceId: ws, userId: stranger.id } }),
    ).toBeNull()
  })

  it('refuses an expired invitation', async () => {
    const owner = await person('owner')
    const joiner = await person('joiner')
    const ws = await workspace(owner)
    const { token, id } = await invite(owner, ws, joiner.email)
    await prisma.workspaceInvitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(400)
  })

  it('refuses a revoked invitation', async () => {
    const owner = await person('owner')
    const joiner = await person('joiner')
    const ws = await workspace(owner)
    const { token, id } = await invite(owner, ws, joiner.email)
    await api(owner, ws, `/invitations/${id}`, { method: 'DELETE' })

    const res = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(400)
  })

  it('refuses a forged token', async () => {
    const joiner = await person('joiner')
    const res = await fetch(`${baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie: joiner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token-but-long-enough' }),
    })
    expect(res.status).toBe(400)
  })
})
