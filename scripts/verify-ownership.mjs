/**
 * OWN-001/002/003 end to end against the RUNNING stack: create an inspection, insurance
 * policy and road tax record, then prove the reminder engine turns an imminent expiry
 * into a real reminder and that renewing it supersedes the old one.
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

// The registration endpoint is rate-limited to 3/hour per IP (SEC-009). Running several
// verification scripts in a row legitimately trips it, so this clears the counters first.
// Local development only — it reaches into Redis directly.
execFileSync(
  'bash',
  [
    '-c',
    "docker exec -i autoservices-redis redis-cli --scan --pattern 'rl:*' | " +
      'xargs -r docker exec -i autoservices-redis redis-cli DEL',
  ],
  { encoding: 'utf8' },
)

const EMAIL = `own-live-${Date.now()}@example.com`
const plusDays = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// --- a real account through the real registration path ---
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'OwnershipLive123!',
    passwordConfirmation: 'OwnershipLive123!',
    displayName: 'Ownership Live',
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
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

try {
  console.log('\n[1] A vehicle to attach obligations to')
  const vehicle = await (
    await call('/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        manufacturer: 'Ford',
        model: 'Mondeo',
        registrationNumber: 'OWN 001',
        distanceUnit: 'MILES',
      }),
    })
  ).json()
  ok(`vehicle ${vehicle.data.id.slice(0, 8)}…`)

  console.log('\n[2] Inspection with advisories, expiring in 10 days')
  const insp = await (
    await call(`/vehicles/${vehicle.data.id}/inspections`, {
      method: 'POST',
      body: JSON.stringify({
        inspectionType: 'MOT',
        result: 'PASS_WITH_ADVISORIES',
        performedOn: plusDays(-355),
        expiresOn: plusDays(10),
        odometer: 52000,
        odometerUnit: 'MILES',
        centreName: 'Live Test MOT Centre',
        advisories: [
          { severity: 'MINOR', text: 'Nearside front tyre worn close to the limit' },
          { severity: 'DANGEROUS', text: 'Brake pipe excessively corroded' },
        ],
      }),
    })
  ).json()
  insp.data.expiryStatus === 'EXPIRING_SOON' && insp.data.daysRemaining === 10
    ? ok(`server computed EXPIRING_SOON, ${insp.data.daysRemaining} days left`)
    : fail(`unexpected expiry state: ${JSON.stringify(insp.data.expiryStatus)}`)
  insp.data.unresolvedAdvisories === 2 ? ok('2 advisories recorded') : fail('advisories not stored')

  console.log('\n[3] Insurance and road tax')
  const pol = await (
    await call(`/vehicles/${vehicle.data.id}/insurance-policies`, {
      method: 'POST',
      body: JSON.stringify({
        providerName: 'Live Test Insurer',
        startsOn: plusDays(-300),
        expiresOn: plusDays(20),
        premiumAmount: '499.99',
        currency: 'GBP',
        renewalType: 'AUTOMATIC',
      }),
    })
  ).json()
  pol.data.premiumAmount === '499.99'
    ? ok('premium stored as an exact decimal string')
    : fail(`premium mangled: ${pol.data.premiumAmount}`)

  const tax = await (
    await call(`/vehicles/${vehicle.data.id}/road-tax`, {
      method: 'POST',
      body: JSON.stringify({
        countryCode: 'ro',
        startsOn: plusDays(-200),
        expiresOn: plusDays(-5),
        amount: '120.00',
      }),
    })
  ).json()
  tax.data.countryCode === 'RO' && tax.data.expiryStatus === 'EXPIRED'
    ? ok('non-UK road tax recorded and correctly reported EXPIRED')
    : fail(`road tax wrong: ${JSON.stringify(tax.data)}`)

  console.log('\n[4] The reminder engine picks all three up')
  const scan = await (
    await fetch(`${API}/internal/reminders/scan`, {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
    })
  ).json()
  const kinds = sql(
    `SELECT string_agg(DISTINCT source_type::text, ',' ORDER BY source_type::text)
     FROM reminders WHERE workspace_id = '${ws}' AND status <> 'CANCELLED';`,
  )
  kinds.includes('INSPECTION') && kinds.includes('INSURANCE') && kinds.includes('TAX')
    ? ok(`reminders raised for: ${kinds}`)
    : fail(
        `expected INSPECTION, INSURANCE and TAX reminders; got "${kinds}" (scan: ${JSON.stringify(scan.data)})`,
      )

  console.log('\n[5] The overdue one reads as overdue, not "in -5 days"')
  const taxTitle = sql(
    `SELECT title FROM reminders WHERE workspace_id = '${ws}' AND source_type = 'TAX' LIMIT 1;`,
  )
  taxTitle.includes('has expired') ? ok(`"${taxTitle}"`) : fail(`unexpected wording: "${taxTitle}"`)

  console.log('\n[6] Renewing supersedes the record it replaces')
  await call(`/vehicles/${vehicle.data.id}/road-tax`, {
    method: 'POST',
    body: JSON.stringify({
      countryCode: 'RO',
      startsOn: plusDays(-4),
      expiresOn: plusDays(360),
    }),
  })
  const stale = sql(
    `SELECT count(*) FROM reminders WHERE workspace_id = '${ws}' AND source_type = 'TAX'
       AND source_id = '${tax.data.id}' AND status <> 'CANCELLED';`,
  )
  stale === '0'
    ? ok('the superseded tax record no longer has an open reminder')
    : fail(`${stale} open reminder(s) still point at the replaced record`)

  console.log('\n[7] A renewed obligation stops being reported as due')
  const rescan = await (
    await fetch(`${API}/internal/reminders/scan`, {
      method: 'POST',
      headers: { 'x-internal-token': TOKEN },
    })
  ).json()
  const openTax = sql(
    `SELECT count(*) FROM reminders WHERE workspace_id = '${ws}' AND source_type = 'TAX'
       AND status IN ('DUE','SENT');`,
  )
  openTax === '0'
    ? ok('no outstanding road-tax reminder after renewal')
    : fail(`still ${openTax} open road-tax reminder(s) (scan: ${JSON.stringify(rescan.data)})`)

  console.log('\n[8] Ownership records stay inside their workspace')
  const otherWs = sql(`SELECT id FROM workspaces WHERE id <> '${ws}' LIMIT 1;`)
  if (otherWs) {
    const res = await fetch(`${API}/workspaces/${otherWs}/inspections`, { headers: { cookie } })
    res.status === 404
      ? ok('another workspace returns 404, not data')
      : fail(`cross-workspace read returned ${res.status}`)
  } else {
    ok('no second workspace to test against')
  }
} finally {
  sql(`DELETE FROM reminders WHERE workspace_id IN
        (SELECT id FROM workspaces WHERE owner_user_id IN
          (SELECT id FROM users WHERE email = '${EMAIL}'));`)
  sql(`DELETE FROM notifications WHERE workspace_id IN
        (SELECT id FROM workspaces WHERE owner_user_id IN
          (SELECT id FROM users WHERE email = '${EMAIL}'));`)
}

console.log(
  process.exitCode ? '\nOWNERSHIP VERIFICATION FAILED\n' : '\nOWNERSHIP MODULES VERIFIED\n',
)
