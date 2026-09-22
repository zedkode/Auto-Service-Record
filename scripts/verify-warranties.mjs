/**
 * OWN-004 end to end: a warranty that runs out on mileage before its date does.
 *
 * That is the case this feature exists for — a product tracking only the expiry date tells
 * the owner they are covered on the day they stop being covered.
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
const errs = []
const check = (condition, good, bad) => {
  if (condition) {
    console.log(`  ✓ ${good}`)
  } else {
    console.error(`  ✗ ${bad}`)
    errs.push(bad)
    process.exitCode = 1
  }
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

const day = (offset) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

const EMAIL = `warranty-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'WarrantyLive123!',
    passwordConfirmation: 'WarrantyLive123!',
    displayName: 'Warranty Live',
    acceptTerms: true,
  }),
})
if (!reg.ok) throw new Error(`register failed: ${reg.status} ${await reg.text()}`)
const cookie = (reg.headers.getSetCookie?.()[0] ?? reg.headers.get('set-cookie') ?? '').split(
  ';',
)[0]
const session = await (await fetch(`${API}/auth/session`, { headers: { cookie } })).json()
const ws = session.data.workspaces[0].id
const call = (p, init = {}) =>
  fetch(`${API}/workspaces/${ws}${p}`, {
    ...init,
    headers: { cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })

/** Setup calls must not fail quietly: an ignored 422 turns later checks into nonsense. */
async function must(label, res) {
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`)
  return (await res.json()).data
}

try {
  console.log('\n[1] A high-mileage car with a 60,000-mile warranty')
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Ford',
          model: 'Mondeo',
          registrationNumber: `WA ${Math.floor(Math.random() * 9000 + 1000)}`,
          distanceUnit: 'MILES',
          currentOdometer: 30_000,
        }),
      })
    ).json()
  ).data

  const created = await call(`/vehicles/${vehicle.id}/warranties`, {
    method: 'POST',
    body: JSON.stringify({
      warrantyType: 'MANUFACTURER',
      providerName: 'Ford',
      startsOn: day(-500),
      expiresOn: day(500),
      distanceLimit: 60_000,
      distanceLimitUnit: 'MILES',
      coverageNotes: 'Powertrain and electrics',
    }),
  })
  const warranty = (await created.json()).data
  check(
    created.status === 201 &&
      warranty.status.state === 'ACTIVE' &&
      warranty.status.distanceRemaining === 30_000,
    `in cover, 30,000 miles and ${warranty.status.daysRemaining} days left`,
    `unexpected initial state: ${JSON.stringify(warranty.status)}`,
  )

  console.log('\n[2] The mileage clock runs out while the date still has a year')
  await must(
    'odometer',
    await call(`/vehicles/${vehicle.id}/odometer`, {
      method: 'POST',
      // `unit` is required: MILES and KILOMETERS are never inferred (AGENTS.md).
      body: JSON.stringify({ value: 64_000, unit: 'MILES', recordedOn: day(0) }),
    }),
  )
  const after = (await (await call(`/warranties/${warranty.id}`)).json()).data
  check(
    after.status.state === 'EXPIRED' &&
      after.status.governedBy === 'DISTANCE' &&
      after.status.daysRemaining > 0,
    `ENDED on mileage (${after.status.distanceRemaining} miles) with ${after.status.daysRemaining} days still on the date`,
    `expected EXPIRED by DISTANCE, got ${JSON.stringify(after.status)}`,
  )

  console.log('\n[3] The state is recomputed, never stored')
  const stored = sql(`SELECT count(*) FROM information_schema.columns
                       WHERE table_name='warranties' AND column_name IN ('status','state');`)
  check(
    stored === '0',
    'no status column exists — a stored state would be a lie the moment the odometer moves',
    'a status column exists on warranties',
  )

  console.log('\n[4] A part warranty counts from when the part was fitted')
  const part = (
    await (
      await call(`/vehicles/${vehicle.id}/warranties`, {
        method: 'POST',
        body: JSON.stringify({
          warrantyType: 'PART',
          providerName: 'LuK',
          startsOn: day(-30),
          distanceLimit: 12_000,
          distanceLimitUnit: 'MILES',
          startOdometer: 60_000,
          startOdometerUnit: 'MILES',
          coverageNotes: 'Clutch kit',
        }),
      })
    ).json()
  ).data
  // 64,000 now, fitted at 60,000: 4,000 used of 12,000.
  check(
    part.status.state === 'ACTIVE' && part.status.distanceRemaining === 8_000,
    '8,000 of 12,000 miles left, counted from the fitting reading',
    `expected 8,000 remaining, got ${JSON.stringify(part.status)}`,
  )

  console.log('\n[5] Units are converted, never compared raw')
  const km = (
    await (
      await call(`/vehicles/${vehicle.id}/warranties`, {
        method: 'POST',
        body: JSON.stringify({
          warrantyType: 'THIRD_PARTY',
          startsOn: day(-10),
          expiresOn: day(700),
          distanceLimit: 200_000,
          distanceLimitUnit: 'KILOMETERS',
        }),
      })
    ).json()
  ).data
  // 64,000 miles is 103,000 km of a 200,000 km limit — comfortably in cover.
  check(
    km.status.state === 'ACTIVE' &&
      km.status.distanceRemaining > 96_000 &&
      km.status.distanceRemaining < 98_000,
    `${km.status.distanceRemaining} km left — the mile reading was converted, not compared raw`,
    `conversion wrong: ${JSON.stringify(km.status)}`,
  )

  console.log('\n[6] A mileage limit with no reading is flagged, not assumed')
  const bare = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({ manufacturer: 'Fiat', model: 'Panda', distanceUnit: 'MILES' }),
      })
    ).json()
  ).data
  const unchecked = (
    await (
      await call(`/vehicles/${bare.id}/warranties`, {
        method: 'POST',
        body: JSON.stringify({
          warrantyType: 'MANUFACTURER',
          startsOn: day(-100),
          expiresOn: day(600),
          distanceLimit: 60_000,
          distanceLimitUnit: 'MILES',
        }),
      })
    ).json()
  ).data
  check(
    unchecked.status.cautions.includes('NO_ODOMETER') &&
      unchecked.status.distanceRemaining === null,
    'NO_ODOMETER flagged; the date verdict still given, with the caveat attached',
    `expected NO_ODOMETER, got ${JSON.stringify(unchecked.status)}`,
  )

  console.log('\n[7] Validation refuses a limit with no unit')
  const noUnit = await call(`/vehicles/${vehicle.id}/warranties`, {
    method: 'POST',
    body: JSON.stringify({ warrantyType: 'DEALER', startsOn: day(-5), distanceLimit: 10_000 }),
  })
  const backwards = await call(`/vehicles/${vehicle.id}/warranties`, {
    method: 'POST',
    body: JSON.stringify({ warrantyType: 'DEALER', startsOn: day(0), expiresOn: day(-100) }),
  })
  check(
    noUnit.status === 422 && backwards.status === 422,
    'a bare distance and a backwards date range are both refused',
    `expected 422/422, got ${noUnit.status}/${backwards.status}`,
  )

  console.log('\n[8] It reaches the reminder engine, on the mileage clock')
  // The scan is an internal route guarded by a shared token, not a workspace endpoint.
  const scan = await fetch(`${API}/internal/reminders/scan`, {
    method: 'POST',
    headers: { 'x-internal-token': process.env.SESSION_SECRET ?? '' },
  })
  if (!scan.ok) throw new Error(`scan failed: ${scan.status} ${await scan.text()}`)
  const reminder = sql(
    `SELECT source_type||'|'||status FROM reminders
      WHERE workspace_id='${ws}' AND source_type='WARRANTY' LIMIT 1;`,
  )
  check(
    reminder.startsWith('WARRANTY|'),
    `a warranty reminder was raised: ${reminder}`,
    `no WARRANTY reminder was created (got "${reminder}")`,
  )

  console.log('\n[9] A warranty that ended long ago is history, not a reminder')
  await must(
    'old warranty',
    await call(`/vehicles/${vehicle.id}/warranties`, {
      method: 'POST',
      body: JSON.stringify({
        warrantyType: 'DEALER',
        startsOn: day(-2000),
        expiresOn: day(-1000),
      }),
    }),
  )
  const rescan = await fetch(`${API}/internal/reminders/scan`, {
    method: 'POST',
    headers: { 'x-internal-token': process.env.SESSION_SECRET ?? '' },
  })
  if (!rescan.ok) throw new Error(`rescan failed: ${rescan.status}`)
  const stale = sql(
    `SELECT count(*) FROM reminders r JOIN warranties w ON w.id = r.source_id
      WHERE r.workspace_id='${ws}' AND r.source_type='WARRANTY' AND w.warranty_type='DEALER';`,
  )
  check(
    stale === '0',
    'a warranty that ended three years ago raises nothing',
    `${stale} reminder(s) for a long-expired warranty`,
  )

  console.log('\n[10] Another workspace cannot see it')
  const strangerEmail = `warranty-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'WarrantyLive123!',
      passwordConfirmation: 'WarrantyLive123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const peek = await fetch(`${API}/workspaces/${ws}/warranties/${warranty.id}`, {
    headers: { cookie: sCookie },
  })
  check(peek.status === 404, '404 for a non-member', `expected 404, got ${peek.status}`)
  for (const t of ['sessions', 'user_profiles', 'email_verification_tokens']) {
    sql(`DELETE FROM ${t} WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`)
  }
  sql(
    `DELETE FROM workspace_members WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(
    `DELETE FROM workspaces WHERE owner_user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(`DELETE FROM users WHERE email='${strangerEmail}';`)

  console.log('\n[11] Removing one is soft, like every other record')
  const removed = await call(`/warranties/${km.id}`, { method: 'DELETE' })
  const row = sql(`SELECT (deleted_at IS NOT NULL)::text FROM warranties WHERE id='${km.id}';`)
  const listed = (await (await call(`/vehicles/${vehicle.id}/warranties`)).json()).data
  check(
    removed.status === 204 && row === 'true' && !listed.some((w) => w.id === km.id),
    'row kept with deleted_at set; gone from the list',
    `delete wrong: ${removed.status}, deleted=${row}`,
  )

  console.log('\n[12] Everything is audited')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE workspace_id='${ws}' AND resource_type='warranty';`,
  )
  check(
    actions.includes('warranty.created') && actions.includes('warranty.deleted'),
    `audited: ${actions}`,
    `missing audit entries: ${actions}`,
  )
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'warranties',
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'service_record_parts',
    'service_records',
    'reminders',
    'notifications',
    'audit_logs',
  ]) {
    sql(`DELETE FROM ${t} WHERE workspace_id IN ${wq};`)
  }
  sql(`DELETE FROM vehicles WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM workspace_members WHERE workspace_id IN ${wq} OR user_id IN ${uq};`)
  sql(`DELETE FROM workspaces WHERE id IN ${wq};`)
  sql(`DELETE FROM sessions WHERE user_id IN ${uq};`)
  sql(`DELETE FROM user_profiles WHERE user_id IN ${uq};`)
  sql(`DELETE FROM email_verification_tokens WHERE user_id IN ${uq};`)
  sql(`DELETE FROM users WHERE email='${EMAIL}';`)
}

console.log(
  errs.length ? `\nWARRANTY VERIFICATION FAILED (${errs.length})\n` : '\nWARRANTIES VERIFIED\n',
)
