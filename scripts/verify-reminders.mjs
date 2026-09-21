/**
 * Verifies the reminder engine end to end:
 * overdue maintenance -> scan -> reminder -> in-app notification -> queued email ->
 * Mailpit, plus snooze/dismiss and idempotency.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const API = 'http://localhost:4100/api/v1'
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 58025}`
const ok = (s) => console.log(`  ✓ ${s}`)
let cookie = ''

async function req(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const sc = res.headers.getSetCookie?.()[0]
  if (sc) cookie = sc.split(';')[0]
  const t = await res.text()
  return { status: res.status, body: t ? JSON.parse(t) : null }
}

const scan = () =>
  fetch(`${API}/internal/reminders/scan`, {
    method: 'POST',
    headers: { 'x-internal-token': process.env.SESSION_SECRET },
  }).then(async (r) => ({ status: r.status, body: await r.json() }))

console.log('\n[1] Sign in')
await req('POST', '/auth/login', {
  email: 'andrei@autoservices.local',
  password: 'DevPassword123!',
})
const ws = (await req('GET', '/auth/session')).body.data.workspaces[0].id
const vehicles = (await req('GET', `/workspaces/${ws}/vehicles`)).body.data
const vehicle = vehicles.find((v) => v.manufacturer === 'Ford')
ok(`workspace ${ws.slice(0, 8)}… vehicle ${vehicle.manufacturer} ${vehicle.model}`)

console.log('\n[2] Force a maintenance item overdue')
const rules = (await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance`)).body.data
const oil = rules.find((r) => r.category?.key === 'engine_oil')
// Complete it far in the past so a 12-month interval is already blown.
await req('POST', `/workspaces/${ws}/maintenance/${oil.id}/complete`, {
  completedOn: '2024-01-15',
  odometer: 100000,
})
const after = (await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance`)).body.data
const oilNow = after.find((r) => r.id === oil.id)
ok(`engine oil is now ${oilNow.status} — "${oilNow.summary}"`)
if (oilNow.status !== 'OVERDUE') throw new Error('expected OVERDUE after a 2024 completion')

console.log('\n[3] Protect the internal scan route')
const noToken = await fetch(`${API}/internal/reminders/scan`, { method: 'POST' })
ok(`no token -> ${noToken.status} (404: the route does not advertise itself)`)
const badToken = await fetch(`${API}/internal/reminders/scan`, {
  method: 'POST',
  headers: { 'x-internal-token': 'wrong-token' },
})
ok(`wrong token -> ${badToken.status}`)
if (noToken.status !== 404 || badToken.status !== 404)
  throw new Error('scan route is not protected')

console.log('\n[4] Run the scan')
const before = await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()
const first = await scan()
ok(`scan -> ${first.status} ${JSON.stringify(first.body.data)}`)
if (first.body.data.created + first.body.data.updated === 0)
  throw new Error('no reminders produced')

console.log('\n[5] Reminder created')
const reminders = (await req('GET', `/workspaces/${ws}/reminders`)).body.data
ok(`${reminders.length} active reminder(s)`)
for (const r of reminders.slice(0, 4)) {
  console.log(`      ${r.status.padEnd(9)} ${r.overdue ? 'OVERDUE ' : '        '}${r.title}`)
}
const oilReminder = reminders.find((r) => r.sourceId === oil.id)
if (!oilReminder) throw new Error('no reminder for the overdue maintenance rule')
ok(`reminder for the overdue item: "${oilReminder.title}"`)

console.log('\n[6] In-app notification created')
const notes = (await req('GET', '/notifications')).body.data
ok(
  `${notes.length} notification(s); unread ${(await req('GET', '/notifications/unread-count')).body.data.count}`,
)
const match = notes.find((n) => n.reminderId === oilReminder.id)
if (!match) throw new Error('no in-app notification for the reminder')
ok(`"${match.title}" -> ${match.actionUrl}`)

console.log('\n[7] Email queued and delivered')
await new Promise((r) => setTimeout(r, 4000))
const afterMail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json()
const delivered = afterMail.messages_count - before.messages_count
ok(`${delivered} email(s) delivered to Mailpit`)
if (delivered > 0) ok(`latest subject: "${afterMail.messages[0].Subject}"`)

console.log('\n[8] IDEMPOTENCY — a second scan must not notify again')
const countBefore = (await req('GET', '/notifications')).body.data.length
const mailBefore = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).messages_count
const second = await scan()
ok(`second scan -> ${JSON.stringify(second.body.data)}`)
await new Promise((r) => setTimeout(r, 3000))
const countAfter = (await req('GET', '/notifications')).body.data.length
const mailAfter = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()).messages_count
ok(`notifications ${countBefore} -> ${countAfter}; emails ${mailBefore} -> ${mailAfter}`)
if (countAfter !== countBefore || mailAfter !== mailBefore) {
  throw new Error('IDEMPOTENCY FAILED: the second scan produced duplicates')
}
ok('no duplicates — the delivery ledger held')

console.log('\n[9] Snooze, dismiss, complete')
const snoozed = await req('POST', `/workspaces/${ws}/reminders/${oilReminder.id}/snooze`, {
  days: 14,
})
ok(
  `snooze -> ${snoozed.status} status=${snoozed.body.data.status} until=${snoozed.body.data.snoozedUntil}`,
)
const thirdScan = await scan()
ok(`scan while snoozed -> notified ${thirdScan.body.data.notified} (should be 0 for this item)`)

const other = reminders.find((r) => r.id !== oilReminder.id)
if (other) {
  const d = await req('POST', `/workspaces/${ws}/reminders/${other.id}/dismiss`)
  ok(`dismiss -> ${d.status}`)
  const remaining = (await req('GET', `/workspaces/${ws}/reminders`)).body.data
  ok(`${remaining.length} active after dismissing one`)
}

console.log('\n[10] Mark notifications read')
const unreadBefore = (await req('GET', '/notifications/unread-count')).body.data.count
await req('POST', `/notifications/${match.id}/read`)
const afterOne = (await req('GET', '/notifications/unread-count')).body.data.count
ok(`unread ${unreadBefore} -> ${afterOne} after marking one read`)
await req('POST', '/notifications/read-all')
ok(`unread after read-all: ${(await req('GET', '/notifications/unread-count')).body.data.count}`)

console.log('\n[11] Summary endpoint')
const summary = (await req('GET', `/workspaces/${ws}/reminders/summary`)).body.data
ok(`summary: ${JSON.stringify(summary)}`)

console.log('\nREMINDER ENGINE VERIFIED')
