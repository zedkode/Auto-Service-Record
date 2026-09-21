/**
 * Verifies MAIL-004 (email history) and SEC-013 (Resend webhook) end to end:
 * send -> email_messages row -> webhook signature checks -> event ingestion ->
 * status advance -> replay/out-of-order safety.
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
const ok = (s) => console.log(`  ✓ ${s}`)

const { signResendWebhook } = await import('../packages/email/dist/webhook.js')

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

async function postWebhook(body, { secret, id, timestamp } = {}) {
  const raw = JSON.stringify(body)
  const headers = signResendWebhook(raw, {
    id: id ?? `evt_${Math.random().toString(36).slice(2)}`,
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
    secret: secret ?? process.env.RESEND_WEBHOOK_SECRET,
  })
  const res = await fetch(`${API}/webhooks/resend`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: raw,
  })
  return { status: res.status, body: await res.json().catch(() => null), headers }
}

// This script asserts the full send -> webhook -> status path, so it needs a send that
// actually happens. Both idempotency layers (the delivery ledger and the Redis
// reservation) correctly suppress a repeat of a reminder already emailed, which would
// otherwise leave a re-run with nothing to track. Local development only.
console.log('\n[0] Clear delivery reservations so the scan has something to send')
const psql = (q) =>
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
psql("DELETE FROM notification_deliveries WHERE channel = 'EMAIL';")
// Three layers dedupe a send, and all three must be cleared or the scan produces
// nothing: the delivery ledger, the Redis reservation, and the retained BullMQ job
// itself — its id is derived from the same deterministic key, so re-adding it is a
// silent no-op while the completed job is still retained (removeOnComplete: 500).
const delKeys = (pattern) =>
  execFileSync(
    'bash',
    [
      '-c',
      `docker exec -i autoservices-redis redis-cli --scan --pattern '${pattern}' | ` +
        'xargs -r docker exec -i autoservices-redis redis-cli DEL',
    ],
    { encoding: 'utf8' },
  ).trim()
const clearedIdem = delKeys('email:idem:*')
const clearedJobs = delKeys('bull:emails:email-*')
ok(`ledger cleared, ${clearedIdem || 0} reservation(s), ${clearedJobs || 0} retained job(s)`)

console.log('\n[1] Trigger a real send through the reminder engine')
await fetch(`${API}/internal/reminders/scan`, {
  method: 'POST',
  headers: { 'x-internal-token': TOKEN },
})
await new Promise((r) => setTimeout(r, 4000))

console.log('\n[2] email_messages rows are written')
const emails = await admin('/emails?limit=5')
ok(`${emails.meta.total} message(s) recorded`)
if (emails.meta.total === 0) throw new Error('no email_messages rows — MAIL-004 not working')
for (const m of emails.data.slice(0, 3)) {
  console.log(`      ${m.status.padEnd(9)} ${m.template.padEnd(16)} ${m.recipientEmail}`)
  console.log(
    `      subject: "${m.subject}"  provider=${m.provider}  id=${m.providerMessageId ?? '-'}`,
  )
}
// Must be a message that has NOT yet reached a terminal state: stage [10] of this script
// bounces whatever it picks, so re-running against the newest message regardless of status
// would start from BOUNCED and fail stage [4] — a defect in the check, not in the pipeline.
const target = emails.data.find((m) => m.providerMessageId && m.status === 'SENT')
if (!target) {
  throw new Error(
    'no message in SENT state to track. Every recent message has already been delivered or ' +
      'bounced by a previous run — trigger a fresh send (a reminder scan) before re-running.',
  )
}
ok(`tracking ${target.id.slice(0, 8)}… provider id ${target.providerMessageId}`)

console.log('\n[3] Webhook rejects unsigned and tampered requests')
const unsigned = await fetch(`${API}/webhooks/resend`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'email.delivered' }),
})
ok(`unsigned -> ${unsigned.status} ${(await unsigned.json()).error?.code}`)
if (unsigned.status !== 401) throw new Error('unsigned webhook was not rejected')

const wrongSecret = await postWebhook(
  { type: 'email.delivered', data: { email_id: target.providerMessageId } },
  { secret: 'whsec_' + Buffer.from('a-totally-different-secret').toString('base64') },
)
ok(`wrong secret -> ${wrongSecret.status}`)
if (wrongSecret.status !== 401) throw new Error('bad signature accepted')

const stale = await postWebhook(
  { type: 'email.delivered', data: { email_id: target.providerMessageId } },
  { timestamp: Math.floor(Date.now() / 1000) - 3600 },
)
ok(`stale timestamp (1h old) -> ${stale.status}`)
if (stale.status !== 401) throw new Error('replay window not enforced')

console.log('\n[4] A valid delivered event advances the status')
const evtId = `evt_delivered_${Date.now()}`
const delivered = await postWebhook(
  {
    type: 'email.delivered',
    created_at: new Date().toISOString(),
    data: { email_id: target.providerMessageId },
  },
  { id: evtId },
)
ok(`delivered -> ${delivered.status} ${JSON.stringify(delivered.body.data)}`)

const afterDeliver = (await admin('/emails?limit=20')).data.find((m) => m.id === target.id)
ok(`status now ${afterDeliver.status}, deliveredAt=${afterDeliver.deliveredAt ? 'set' : 'null'}`)
if (afterDeliver.status !== 'DELIVERED') throw new Error('status did not advance to DELIVERED')

console.log('\n[5] Replaying the SAME event is a no-op')
const replay = await postWebhook(
  { type: 'email.delivered', data: { email_id: target.providerMessageId } },
  { id: evtId },
)
ok(`replay -> ${replay.status} ${JSON.stringify(replay.body.data)}`)
if (replay.body.data.processed !== false) throw new Error('replayed event was processed again')

console.log('\n[6] A late "sent" event must NOT regress a delivered message')
const late = await postWebhook(
  { type: 'email.sent', data: { email_id: target.providerMessageId } },
  { id: `evt_late_${Date.now()}` },
)
const afterLate = (await admin('/emails?limit=20')).data.find((m) => m.id === target.id)
ok(`late sent -> advanced=${late.body.data.advanced}; status still ${afterLate.status}`)
if (afterLate.status !== 'DELIVERED') throw new Error('STATUS REGRESSED on an out-of-order event')
ok(`${afterLate.events.length} event(s) recorded in history`)

console.log('\n[7] A bounce outranks delivery')
const bounced = await postWebhook(
  { type: 'email.bounced', data: { email_id: target.providerMessageId } },
  { id: `evt_bounce_${Date.now()}` },
)
const afterBounce = (await admin('/emails?limit=20')).data.find((m) => m.id === target.id)
ok(`bounced -> advanced=${bounced.body.data.advanced}; status ${afterBounce.status}`)
if (afterBounce.status !== 'BOUNCED') throw new Error('a bounce should outrank delivered')

console.log('\n[8] Unknown message id is recorded, not silently dropped')
const orphan = await postWebhook(
  { type: 'email.delivered', data: { email_id: 'msg_does_not_exist' } },
  { id: `evt_orphan_${Date.now()}` },
)
ok(`unknown message -> ${orphan.status} ${JSON.stringify(orphan.body.data)}`)

console.log('\n[9] Admin operational endpoints')
const stats = await admin('/emails/stats')
ok(`email stats: ${JSON.stringify(stats.data)}`)
const queues = await admin('/queues')
ok(
  `queues: ${queues.data.map((q) => `${q.name}(${q.counts.completed}✓/${q.counts.failed}✗)`).join(' ')}`,
)
const metrics = await admin('/metrics')
ok(`metrics: ${JSON.stringify(metrics.data)}`)
const audit = await admin('/audit?limit=3')
ok(`audit: ${audit.data.length} recent entries, latest "${audit.data[0]?.action}"`)

console.log('\n[10] Admin endpoints are protected')
const noSession = await fetch(`${API}/admin/emails`)
ok(`no session -> ${noSession.status}`)
if (noSession.status !== 404) throw new Error('admin endpoints are not protected')
// The shared secret that used to open these must no longer work anywhere.
const oldGate = await fetch(`${API}/admin/emails`, { headers: { 'x-internal-token': TOKEN } })
ok(`retired shared secret -> ${oldGate.status}`)
if (oldGate.status !== 404) throw new Error('the retired shared secret still works')

cleanupAdmin()
console.log('\nEMAIL TRACKING + WEBHOOK VERIFIED')
