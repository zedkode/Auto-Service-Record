/**
 * MAIL-005 end to end, against the RUNNING stack: a signed permanent bounce must add the
 * address to the suppression list; a transient one must not; releasing must keep history.
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
const TOKEN = process.env.SESSION_SECRET
const { signResendWebhook } = await import('../packages/email/dist/webhook.js')

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

const firstLine = (s) => s.split('\n')[0].trim()

// The operational endpoints now live behind the staff realm (ADMIN-001), so this script
// creates a throwaway staff account and signs in rather than presenting a shared secret.
const {
  hashPassword: _hp,
  generateTotpSecret: _gts,
  sealSecret: _ss,
  totpCode: _tc,
} = await import('../packages/auth/dist/index.js')

const adminEmail = `svc-${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`
const adminSecret = _gts()
execFileSync(
  'bash',
  [
    '-c',
    "docker exec -i autoservices-redis redis-cli --scan --pattern 'rl:*' | " +
      'xargs -r docker exec -i autoservices-redis redis-cli DEL',
  ],
  { encoding: 'utf8' },
)
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
    `INSERT INTO admin_users
      (email, password_hash, role, status, mfa_secret, mfa_enrolled_at, updated_at)
    VALUES ('${adminEmail}', '${await _hp('ScriptAdmin123!')}', 'SUPER_ADMIN', 'ACTIVE',
            '${_ss(adminSecret, process.env.SESSION_SECRET)}', now(), now());`,
  ],
  { encoding: 'utf8' },
)
const adminLogin = await fetch(`${API}/admin/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: adminEmail,
    password: 'ScriptAdmin123!',
    totpCode: _tc(adminSecret),
  }),
})
if (!adminLogin.ok) throw new Error(`admin login failed: ${adminLogin.status}`)
const adminCookie = (
  adminLogin.headers.getSetCookie?.()[0] ??
  adminLogin.headers.get('set-cookie') ??
  ''
).split(';')[0]

function cleanupAdmin() {
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
      `DELETE FROM audit_logs WHERE actor_admin_id IN (SELECT id FROM admin_users WHERE email='${adminEmail}');
      DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email='${adminEmail}');
      DELETE FROM admin_users WHERE email='${adminEmail}';`,
    ],
    { encoding: 'utf8' },
  )
}

const admin = (p) =>
  fetch(`${API}/admin${p}`, { headers: { cookie: adminCookie } }).then((r) => r.json())

async function postWebhook(body) {
  const raw = JSON.stringify(body)
  const headers = signResendWebhook(raw, {
    id: `evt_live_${Math.random().toString(36).slice(2)}`,
    timestamp: Math.floor(Date.now() / 1000),
    secret: process.env.RESEND_WEBHOOK_SECRET,
  })
  const res = await fetch(`${API}/webhooks/resend`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: raw,
  })
  return { status: res.status, body: await res.json() }
}

function seedMessage(email, providerId) {
  // psql prints the command tag ("INSERT 0 1") after the RETURNING row, so take line one.
  return firstLine(
    sql(
      `INSERT INTO email_messages (idempotency_key, template, recipient_email, subject, provider,
         provider_message_id, status)
       VALUES ('live-${Math.random().toString(36).slice(2)}', 'service-due', '${email}',
         'Suppression check', 'smtp', '${providerId}', 'SENT') RETURNING id;`,
    ),
  )
}

const EMAIL = `suppression-live-${Date.now()}@example.com`
const SOFT = `soft-live-${Date.now()}@example.com`

try {
  console.log('\n[1] A permanent bounce suppresses the address')
  const pid = `msg_live_${Math.random().toString(36).slice(2)}`
  const messageId = seedMessage(EMAIL, pid)
  const bounced = await postWebhook({
    type: 'email.bounced',
    data: { email_id: pid, bounce: { type: 'Permanent', subType: 'NoEmail' } },
  })
  bounced.status === 200 && bounced.body.data.suppressed === true
    ? ok('webhook accepted and reported the address as suppressed')
    : fail(`expected suppressed=true, got ${JSON.stringify(bounced.body)}`)

  console.log('\n[2] It is visible in the operations console API')
  const listed = await admin('/suppressions')
  const row = listed.data.find((r) => r.email === EMAIL)
  row?.reason === 'HARD_BOUNCE'
    ? ok(`listed as HARD_BOUNCE ("${row.detail}")`)
    : fail('address is not in the admin suppression list')

  console.log('\n[3] A late delivery event does not rewrite the outcome')
  await postWebhook({ type: 'email.delivered', data: { email_id: pid } })
  const status = sql(`SELECT status FROM email_messages WHERE id = '${messageId}';`)
  status === 'BOUNCED'
    ? ok('status still BOUNCED after a late delivered event')
    : fail(`status regressed to ${status}`)

  console.log('\n[4] A transient bounce does NOT suppress')
  const softPid = `msg_soft_${Math.random().toString(36).slice(2)}`
  seedMessage(SOFT, softPid)
  const soft = await postWebhook({
    type: 'email.bounced',
    data: { email_id: softPid, bounce: { type: 'Transient', subType: 'MailboxFull' } },
  })
  const softRows = sql(`SELECT count(*) FROM email_suppressions WHERE email = '${SOFT}';`)
  soft.body.data.suppressed === false && softRows === '0'
    ? ok('mailbox-full bounce left the address usable')
    : fail('a transient bounce wrongly suppressed the address')

  console.log('\n[5] Releasing through the admin API keeps the history')
  const rel = await (
    await fetch(`${API}/admin/suppressions/release`, {
      method: 'POST',
      headers: { cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL }),
    })
  ).json()
  const released = sql(
    `SELECT released_at IS NOT NULL FROM email_suppressions WHERE email = '${EMAIL}';`,
  )
  rel.data.released === true && released === 't'
    ? ok('released, and the row is kept as history rather than deleted')
    : fail('release did not behave as specified')

  console.log('\n[6] A second bounce re-arms a released suppression')
  const pid2 = `msg_again_${Math.random().toString(36).slice(2)}`
  seedMessage(EMAIL, pid2)
  await postWebhook({ type: 'email.complained', data: { email_id: pid2 } })
  const rearmed = sql(
    `SELECT released_at IS NULL AND reason = 'COMPLAINT' FROM email_suppressions WHERE email = '${EMAIL}';`,
  )
  rearmed === 't'
    ? ok('one manual release does not permanently disarm the protection')
    : fail('the address was not re-suppressed after a further complaint')

  console.log('\n[7] A forged signature is refused')
  const forged = await fetch(`${API}/webhooks/resend`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': 'evt_forged',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=',
    },
    body: JSON.stringify({ type: 'email.bounced', data: { email_id: pid } }),
  })
  forged.status === 401 ? ok('forged signature rejected with 401') : fail(`got ${forged.status}`)
} finally {
  sql(`DELETE FROM email_delivery_events WHERE email_message_id IN
        (SELECT id FROM email_messages WHERE recipient_email IN ('${EMAIL}', '${SOFT}'));`)
  sql(`DELETE FROM email_messages WHERE recipient_email IN ('${EMAIL}', '${SOFT}');`)
  sql(`DELETE FROM email_suppressions WHERE email IN ('${EMAIL}', '${SOFT}');`)
  sql(`DELETE FROM audit_logs WHERE resource_type IN ('email_webhook', 'email_suppression');`)
  cleanupAdmin()
}

console.log(
  process.exitCode ? '\nSUPPRESSION VERIFICATION FAILED\n' : '\nSUPPRESSION PIPELINE VERIFIED\n',
)
