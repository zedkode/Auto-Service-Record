/**
 * ADMIN-001/002, SEC-017 end to end against the RUNNING stack.
 *
 * Creates its own staff account with a runtime-generated secret — nothing is committed —
 * then proves the realm behaves: two factors mandatory, roles enforced, customer sessions
 * worthless here, and the old shared-secret gate gone.
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

const { hashPassword, generateTotpSecret, sealSecret, totpCode } = await import(
  '../packages/auth/dist/index.js'
)

const PASSWORD = 'AdminRealmLive123!'
const created = []

async function makeAdmin(role) {
  const email = `admin-live-${role.toLowerCase()}-${Date.now()}@example.com`
  const secret = generateTotpSecret()
  const hash = await hashPassword(PASSWORD)
  const sealed = sealSecret(secret, KEY)
  // `updated_at` is populated by Prisma's @updatedAt, not by a database default, so a
  // raw insert has to set it explicitly.
  sql(
    `INSERT INTO admin_users
       (email, password_hash, role, status, mfa_secret, mfa_enrolled_at, updated_at)
     VALUES ('${email}', '${hash}', '${role}', 'ACTIVE', '${sealed}', now(), now());`,
  )
  created.push(email)
  return { email, secret }
}

async function login(admin, over = {}) {
  const res = await fetch(`${API}/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: admin.email,
      password: PASSWORD,
      totpCode: totpCode(admin.secret),
      ...over,
    }),
  })
  const cookie = (res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  return { res, cookie }
}

try {
  console.log('\n[1] The console is unreachable without a session')
  const anon = await fetch(`${API}/admin/metrics`)
  anon.status === 404
    ? ok('404, which does not confirm the console exists')
    : fail(`expected 404, got ${anon.status}`)

  console.log('\n[2] The old shared-secret gate is gone')
  const oldGate = await fetch(`${API}/internal/admin/metrics`, {
    headers: { 'x-internal-token': KEY },
  })
  const oldGate2 = await fetch(`${API}/admin/metrics`, { headers: { 'x-internal-token': KEY } })
  oldGate.status === 404 && oldGate2.status === 404
    ? ok('the bundled secret opens nothing')
    : fail(`shared secret still works: ${oldGate.status}/${oldGate2.status}`)

  console.log('\n[3] Both factors are required')
  const ops = await makeAdmin('OPERATIONS')
  const noCode = await login(ops, { totpCode: '000000' })
  const badPass = await login(ops, { password: 'wrong-password' })
  noCode.res.status === 401 && badPass.res.status === 401
    ? ok('password alone and code alone are both refused')
    : fail(`expected 401/401, got ${noCode.res.status}/${badPass.res.status}`)

  console.log('\n[4] A correct pair signs in')
  const good = await login(ops)
  good.res.status === 200 && good.cookie.startsWith('as_admin_session=')
    ? ok('session issued on an admin-scoped cookie')
    : fail(`login failed: ${good.res.status} ${await good.res.text()}`)

  console.log('\n[5] The session opens the console')
  const metrics = await fetch(`${API}/admin/metrics`, { headers: { cookie: good.cookie } })
  const body = await metrics.json()
  metrics.status === 200 && typeof body.data.users === 'number'
    ? ok(`metrics readable: ${JSON.stringify(body.data).slice(0, 60)}…`)
    : fail(`metrics failed: ${metrics.status}`)

  console.log('\n[6] Roles are enforced, not decorative')
  const billing = await makeAdmin('BILLING')
  const billingLogin = await login(billing)
  const forbidden = await fetch(`${API}/admin/suppressions/release`, {
    method: 'POST',
    headers: { cookie: billingLogin.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'someone@example.com' }),
  })
  const allowed = await fetch(`${API}/admin/suppressions/release`, {
    method: 'POST',
    headers: { cookie: good.cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'someone@example.com' }),
  })
  forbidden.status === 403 && allowed.status === 201
    ? ok('BILLING refused (403), OPERATIONS allowed')
    : fail(`expected 403 then 201; got ${forbidden.status} then ${allowed.status}`)

  console.log('\n[7] A customer session is worthless here')
  const email = `admin-cust-${Date.now()}@example.com`
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'CustomerLive123!',
      passwordConfirmation: 'CustomerLive123!',
      displayName: 'Customer',
      acceptTerms: true,
    }),
  })
  const custCookie = (reg.headers.getSetCookie?.()[0] ?? reg.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  const crossed = await fetch(`${API}/admin/metrics`, { headers: { cookie: custCookie } })
  crossed.status === 404
    ? ok('a customer cookie does not authenticate a staff route')
    : fail(`customer session reached the admin API: ${crossed.status}`)

  console.log('\n[8] And an admin session is worthless on customer routes')
  const backwards = await fetch(`${API}/auth/session`, { headers: { cookie: good.cookie } })
  backwards.status === 401
    ? ok('staff cookie rejected by the customer realm')
    : fail(`admin session accepted by customer API: ${backwards.status}`)

  console.log('\n[9] The TOTP secret is never stored in the clear')
  const stored = sql(`SELECT mfa_secret FROM admin_users WHERE email = '${ops.email}';`)
  !stored.includes(ops.secret) && stored.startsWith('v1.')
    ? ok('sealed with AES-256-GCM, not readable from the database')
    : fail('MFA secret is not protected')

  console.log('\n[10] Staff actions are audited as ADMIN')
  const audited = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE actor_admin_id IS NOT NULL;`,
  )
  const leaked = sql(`SELECT count(*) FROM audit_logs WHERE metadata::text LIKE '%${PASSWORD}%';`)
  audited.includes('admin.signed_in') && audited.includes('admin.sign_in_failed') && leaked === '0'
    ? ok(`audited: ${audited}`)
    : fail(`audit wrong: "${audited}", leaked=${leaked}`)

  console.log('\n[11] Signing out ends it immediately')
  await fetch(`${API}/admin/auth/logout`, { method: 'POST', headers: { cookie: good.cookie } })
  const after = await fetch(`${API}/admin/metrics`, { headers: { cookie: good.cookie } })
  after.status === 404 ? ok('revoked session is refused') : fail(`still valid: ${after.status}`)
} finally {
  for (const email of created) {
    sql(
      `DELETE FROM audit_logs WHERE actor_admin_id IN (SELECT id FROM admin_users WHERE email='${email}');`,
    )
    sql(
      `DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email='${email}');`,
    )
    sql(`DELETE FROM admin_users WHERE email='${email}';`)
  }
  sql(`DELETE FROM email_suppressions WHERE email = 'someone@example.com';`)
}

console.log(process.exitCode ? '\nADMIN REALM VERIFICATION FAILED\n' : '\nADMIN REALM VERIFIED\n')
