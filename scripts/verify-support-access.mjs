/**
 * SEC-018 end to end against the RUNNING stack.
 *
 * Proves the property the whole task exists for: no staff role reaches customer content
 * without a grant, a grant is narrow and time-boxed, and EVERY use is recorded.
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
const KEY = process.env.SESSION_SECRET
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

const { hashPassword, generateTotpSecret, sealSecret, totpCode } = await import(
  '../packages/auth/dist/index.js'
)

const PASSWORD = 'SupportLive123!'
const REASON = 'Live check: customer reports their MOT certificate is missing after renewal.'
const staffEmails = []

async function staff(role) {
  const email = `sa-live-${role.toLowerCase()}-${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`
  const secret = generateTotpSecret()
  sql(
    `INSERT INTO admin_users
       (email, password_hash, role, status, mfa_secret, mfa_enrolled_at, updated_at)
     VALUES ('${email}', '${await hashPassword(PASSWORD)}', '${role}', 'ACTIVE',
             '${sealSecret(secret, KEY)}', now(), now());`,
  )
  staffEmails.push(email)
  const res = await fetch(`${API}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, totpCode: totpCode(secret) }),
  })
  if (!res.ok) throw new Error(`login failed for ${role}: ${res.status}`)
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  return { email, cookie }
}

const call = (s, p, init = {}) =>
  fetch(`${API}${p}`, {
    ...init,
    headers: {
      cookie: s.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

// A real customer workspace to be the subject.
const custEmail = `sa-live-cust-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: custEmail,
    password: 'CustomerLive123!',
    passwordConfirmation: 'CustomerLive123!',
    displayName: 'Support Subject',
    acceptTerms: true,
  }),
})
if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
const custCookie = (reg.headers.getSetCookie?.()[0] ?? reg.headers.get('set-cookie') ?? '').split(
  ';',
)[0]
const session = await (
  await fetch(`${API}/auth/session`, { headers: { cookie: custCookie } })
).json()
const ws = session.data.workspaces[0].id
await fetch(`${API}/workspaces/${ws}/vehicles`, {
  method: 'POST',
  headers: { cookie: custCookie, 'content-type': 'application/json' },
  body: JSON.stringify({
    manufacturer: 'Ford',
    model: 'Mondeo',
    registrationNumber: 'SA99 LIV',
    distanceUnit: 'MILES',
  }),
})

try {
  console.log('\n[1] Even a SUPER_ADMIN cannot read customer content unaided')
  const boss = await staff('SUPER_ADMIN')
  const blocked = await call(boss, `/admin/workspaces/${ws}/vehicles`)
  blocked.status === 404
    ? ok('404 — privilege is not the mechanism here')
    : fail(`SUPER_ADMIN read content without a grant: ${blocked.status}`)

  console.log('\n[2] Metadata is still available, which is most of support')
  const meta = await call(boss, `/admin/workspaces/${ws}`)
  const metaBody = await meta.json()
  meta.status === 200 && !JSON.stringify(metaBody.data).includes('SA99 LIV')
    ? ok(`counts visible, registrations not: ${JSON.stringify(metaBody.data.counts)}`)
    : fail(`metadata endpoint wrong: ${meta.status}`)

  console.log('\n[3] The refusal is recorded')
  const denied = sql(
    `SELECT count(*) FROM audit_logs WHERE action = 'support_access.denied' AND workspace_id = '${ws}';`,
  )
  Number(denied) > 0 ? ok(`${denied} denial(s) audited`) : fail('a denied attempt left no trace')

  console.log('\n[4] A reason that is not a reason is refused')
  const support = await staff('SUPPORT')
  const thin = await call(support, '/admin/support-access', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: ws, reason: 'debugging', scope: 'FULL', hours: 4 }),
  })
  const tooLong = await call(support, '/admin/support-access', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: ws, reason: REASON, scope: 'FULL', hours: 48 }),
  })
  thin.status === 422 && tooLong.status === 422
    ? ok('thin reason and >24h both refused')
    : fail(`expected 422/422, got ${thin.status}/${tooLong.status}`)

  console.log('\n[5] A proper request is granted, narrow and time-boxed')
  const granted = await call(support, '/admin/support-access', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: ws, reason: REASON, scope: 'VEHICLE_CONTENT', hours: 2 }),
  })
  const grant = (await granted.json()).data
  granted.status === 201 && grant.isActive && grant.minutesRemaining <= 120
    ? ok(`granted for ${grant.minutesRemaining} minutes, scope ${grant.scope}`)
    : fail(`grant wrong: ${JSON.stringify(grant)}`)

  console.log('\n[6] It opens exactly what it covers, and nothing else')
  const vehicles = await call(support, `/admin/workspaces/${ws}/vehicles`)
  const docs = await call(support, `/admin/workspaces/${ws}/documents`)
  const list = await vehicles.json()
  vehicles.status === 200 && list.data[0]?.registrationNumber === 'SA99 LIV' && docs.status === 404
    ? ok('vehicles readable; documents still refused under a VEHICLE_CONTENT grant')
    : fail(`scope not honoured: vehicles=${vehicles.status} docs=${docs.status}`)

  console.log('\n[7] Every use is recorded, not just the granting')
  await call(support, `/admin/workspaces/${ws}/vehicles`)
  await call(support, `/admin/workspaces/${ws}/vehicles`)
  const uses = sql(
    `SELECT count(*) FROM audit_logs WHERE action LIKE 'support_access.used%' AND workspace_id = '${ws}';`,
  )
  const counted = sql(`SELECT use_count FROM support_access_grants WHERE id = '${grant.id}';`)
  uses === '3' && counted === '3'
    ? ok(`3 uses audited and counted on the grant`)
    : fail(`expected 3 uses; audit=${uses} grant=${counted}`)

  console.log('\n[8] The register is visible to staff who cannot request access')
  const watcher = await staff('READ_ONLY')
  const register = await (await call(watcher, '/admin/support-access')).json()
  register.data.some((g) => g.adminEmail === support.email && g.reason.includes('MOT'))
    ? ok('a read-only role sees who holds access and why')
    : fail('the register does not show live grants')

  console.log('\n[9] Revoking ends it immediately')
  await call(support, `/admin/support-access/${grant.id}`, { method: 'DELETE' })
  const after = await call(support, `/admin/workspaces/${ws}/vehicles`)
  after.status === 404
    ? ok('access ends the moment it is revoked')
    : fail(`still open: ${after.status}`)

  console.log('\n[10] A grant never yields a document’s contents')
  const full = await call(support, '/admin/support-access', {
    method: 'POST',
    body: JSON.stringify({ workspaceId: ws, reason: REASON, scope: 'FULL', hours: 1 }),
  })
  const fullGrant = (await full.json()).data
  const docList = await (await call(support, `/admin/workspaces/${ws}/documents`)).json()
  const serialised = JSON.stringify(docList)
  !serialised.includes('storageKey') && !serialised.includes('X-Amz-Signature')
    ? ok('document metadata only — no key, no download link')
    : fail('a grant exposed document contents')
  await call(support, `/admin/support-access/${fullGrant.id}`, { method: 'DELETE' })
} finally {
  sql(`DELETE FROM audit_logs WHERE workspace_id = '${ws}';`)
  for (const email of staffEmails) {
    const idq = `(SELECT id FROM admin_users WHERE email='${email}')`
    sql(`DELETE FROM audit_logs WHERE actor_admin_id IN ${idq};`)
    sql(`DELETE FROM support_access_grants WHERE admin_user_id IN ${idq};`)
    sql(`DELETE FROM admin_sessions WHERE admin_user_id IN ${idq};`)
    sql(`DELETE FROM admin_users WHERE email='${email}';`)
  }
}

console.log(
  process.exitCode ? '\nSUPPORT ACCESS VERIFICATION FAILED\n' : '\nSUPPORT ACCESS VERIFIED\n',
)
