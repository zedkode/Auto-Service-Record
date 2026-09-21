/**
 * WS-002/003/004 end to end against the RUNNING stack.
 *
 * Two people, a real invitation email delivered to Mailpit, a real acceptance, role
 * changes, removal, and an ownership transfer — plus the invariants that must hold when
 * somebody tries to break them.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const API = 'http://localhost:4100/api/v1'
// Our Mailpit, not the one another project runs on the default 8025 (D-025 remapped
// every port in this stack to avoid exactly that collision).
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '58025'}`
const ok = (s) => console.log(`  ✓ ${s}`)
const fail = (s) => {
  console.error(`  ✗ ${s}`)
  process.exitCode = 1
}
const sql = (q) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'autoservices-postgres',
      'psql',
      '-U',
      'autoservices',
      '-d',
      'autoservices',
      '-tAc',
      q,
    ],
    { encoding: 'utf8' },
  ).trim()

execFileSync(
  'bash',
  [
    '-c',
    "docker exec -i autoservices-redis redis-cli --scan --pattern 'rl:*' | " +
      'xargs -r docker exec -i autoservices-redis redis-cli DEL',
  ],
  { encoding: 'utf8' },
)

const stamp = Date.now()
const emails = []

async function signUp(label) {
  const email = `mem-live-${label}-${stamp}${Math.random().toString(36).slice(2, 5)}@example.com`
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'MembersLive123!',
      passwordConfirmation: 'MembersLive123!',
      displayName: label,
      acceptTerms: true,
    }),
  })
  if (!res.ok) throw new Error(`register ${label} failed: ${res.status} ${await res.text()}`)
  emails.push(email)
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  const session = await (await fetch(`${API}/auth/session`, { headers: { cookie } })).json()
  return { email, cookie, ws: session.data.workspaces[0].id, id: session.data.user.id }
}

const call = (who, wsId, p, init = {}) =>
  fetch(`${API}/workspaces/${wsId}${p}`, {
    ...init,
    headers: {
      cookie: who.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

try {
  const owner = await signUp('owner')
  const invitee = await signUp('invitee')
  const ws = owner.ws

  console.log('\n[1] A stranger cannot see the workspace at all')
  const before = await call(invitee, ws, '/vehicles')
  before.status === 404 ? ok('404 for a non-member') : fail(`expected 404, got ${before.status}`)

  console.log('\n[2] The owner invites them by email')
  const invited = await call(owner, ws, '/invitations', {
    method: 'POST',
    body: JSON.stringify({ email: invitee.email, role: 'EDITOR' }),
  })
  const invitation = (await invited.json()).data
  invited.status === 201 && !JSON.stringify(invitation).includes('token')
    ? ok('invitation created; no token in the response')
    : fail(`invite failed: ${invited.status}`)

  console.log('\n[3] The email actually arrives, with a working link')
  let link = null
  for (let i = 0; i < 20 && !link; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const box = await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(invitee.email)}`)
    ).json()
    const msg = (box.messages ?? []).find((m) => (m.Subject ?? '').includes('invited you'))
    if (!msg) continue
    const body = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).text()
    const match = body.match(/invitations\/accept\?token=([A-Za-z0-9_-]+)/)
    if (match) link = match[1]
  }
  link
    ? ok(`invitation email delivered, token recovered from the link`)
    : fail('no invitation email arrived')

  console.log('\n[4] The public preview names the workspace, nothing more')
  const preview = await (await fetch(`${API}/invitations/preview?token=${link}`)).json()
  preview.data?.role === 'EDITOR' && preview.data.workspaceName
    ? ok(`preview: "${preview.data.workspaceName}" as ${preview.data.role}`)
    : fail(`preview wrong: ${JSON.stringify(preview)}`)

  console.log('\n[5] Someone else cannot use a forwarded invitation')
  const stranger = await signUp('stranger')
  const stolen = await fetch(`${API}/invitations/accept`, {
    method: 'POST',
    headers: { cookie: stranger.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ token: link }),
  })
  stolen.status === 422
    ? ok('refused — the invitation is bound to the invited address')
    : fail(`a forwarded invitation was accepted: ${stolen.status}`)

  console.log('\n[6] The invited person accepts and gets in')
  const accepted = await fetch(`${API}/invitations/accept`, {
    method: 'POST',
    headers: { cookie: invitee.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ token: link }),
  })
  const after = await call(invitee, ws, '/vehicles')
  accepted.status === 201 && after.status === 200
    ? ok('joined, and the workspace is now visible to them')
    : fail(`accept failed: ${accepted.status}, access ${after.status}`)

  console.log('\n[7] The token is spent')
  const replay = await fetch(`${API}/invitations/accept`, {
    method: 'POST',
    headers: { cookie: invitee.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ token: link }),
  })
  replay.status === 400
    ? ok('replay refused like a forged token')
    : fail(`replay gave ${replay.status}`)

  console.log('\n[8] An EDITOR cannot manage members')
  const overreach = await call(invitee, ws, '/invitations', {
    method: 'POST',
    body: JSON.stringify({ email: 'nobody@example.com', role: 'VIEWER' }),
  })
  overreach.status === 403 ? ok('403 for an EDITOR inviting') : fail(`got ${overreach.status}`)

  console.log('\n[9] The owner changes their role')
  const members = (await (await call(owner, ws, '/members')).json()).data
  const inviteeMember = members.find((m) => m.user.email === invitee.email)
  const changed = await call(owner, ws, `/members/${inviteeMember.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'ADMIN' }),
  })
  changed.status === 200 && (await changed.json()).data.role === 'ADMIN'
    ? ok('EDITOR promoted to ADMIN')
    : fail(`role change failed: ${changed.status}`)

  console.log('\n[10] The new ADMIN still cannot touch the owner')
  const ownerMember = members.find((m) => m.role === 'OWNER')
  const attack = await call(invitee, ws, `/members/${ownerMember.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'VIEWER' }),
  })
  const attack2 = await call(invitee, ws, `/members/${ownerMember.id}`, { method: 'DELETE' })
  attack.status === 403 && attack2.status === 403
    ? ok('an ADMIN cannot demote or remove the OWNER')
    : fail(`expected 403/403, got ${attack.status}/${attack2.status}`)

  console.log('\n[11] The owner cannot simply leave')
  const escape = await call(owner, ws, '/members/leave', { method: 'POST' })
  escape.status === 422
    ? ok('refused — a workspace is never left without an owner')
    : fail(`owner left: ${escape.status}`)

  console.log('\n[12] Ownership transfer is atomic')
  const transferred = await call(owner, ws, '/members/transfer-ownership', {
    method: 'POST',
    body: JSON.stringify({ memberId: inviteeMember.id, confirm: 'TRANSFER' }),
  })
  const owners = sql(
    `SELECT count(*) FROM workspace_members WHERE workspace_id='${ws}' AND role='OWNER' AND status='ACTIVE';`,
  )
  const pointer = sql(`SELECT owner_user_id FROM workspaces WHERE id='${ws}';`)
  const oldRole = sql(
    `SELECT role FROM workspace_members WHERE workspace_id='${ws}' AND user_id='${owner.id}';`,
  )
  transferred.status === 201 && owners === '1' && pointer === invitee.id && oldRole === 'ADMIN'
    ? ok('exactly one owner, pointer moved, previous owner demoted to ADMIN')
    : fail(`transfer wrong: status=${transferred.status} owners=${owners} role=${oldRole}`)

  console.log('\n[13] Everything is audited')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs WHERE workspace_id='${ws}';`,
  )
  const expected = [
    'member.invited',
    'member.joined',
    'member.role_changed',
    'workspace.ownership_transferred',
  ]
  expected.every((a) => actions.includes(a))
    ? ok(`audited: ${actions}`)
    : fail(`missing audit entries: ${actions}`)
} finally {
  for (const email of emails) {
    const uq = `(SELECT id FROM users WHERE email='${email}')`
    const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
    sql(`DELETE FROM audit_logs WHERE workspace_id IN ${wq} OR actor_user_id IN ${uq};`)
    sql(`DELETE FROM workspace_invitations WHERE workspace_id IN ${wq};`)
    sql(`DELETE FROM workspace_members WHERE workspace_id IN ${wq} OR user_id IN ${uq};`)
    sql(`DELETE FROM workspaces WHERE id IN ${wq};`)
    sql(`DELETE FROM sessions WHERE user_id IN ${uq};`)
    sql(`DELETE FROM user_profiles WHERE user_id IN ${uq};`)
    sql(`DELETE FROM email_verification_tokens WHERE user_id IN ${uq};`)
    sql(`DELETE FROM users WHERE email='${email}';`)
  }
}

console.log(process.exitCode ? '\nMEMBERSHIP VERIFICATION FAILED\n' : '\nMEMBERSHIP VERIFIED\n')
