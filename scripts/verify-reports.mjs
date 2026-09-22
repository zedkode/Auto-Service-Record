/**
 * RPT-001/002 end to end: build a year of real history through the API, then check the
 * report answers the question INIT.md §1 asks — what has this vehicle cost, per mile and
 * per year — and refuses to answer when the data cannot support it.
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

const EMAIL = `rpt-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'ReportLive123!',
    passwordConfirmation: 'ReportLive123!',
    displayName: 'Report Live',
    acceptTerms: true,
  }),
})
if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
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

const YEAR = 'from=2026-01-01&to=2026-12-31'
const report = async (extra = '') =>
  (await (await call(`/reports/costs?${YEAR}${extra}`)).json()).data

try {
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Ford',
          model: 'Mondeo',
          distanceUnit: 'KILOMETERS',
          fuelType: 'DIESEL',
        }),
      })
    ).json()
  ).data

  console.log('\n[1] An empty year reports zero and says what is missing')
  const blank = await report()
  blank.total === '0.00' && blank.distance.unavailableReason === 'NO_READINGS'
    ? ok('zero total, NO_READINGS for distance — nothing invented')
    : fail(`unexpected: ${JSON.stringify(blank.distance)}`)

  console.log('\n[2] A year of real history')
  await call(`/vehicles/${vehicle.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: '2026-02-10',
      title: 'Major service',
      totalAmount: '600.00',
      currency: 'GBP',
      odometer: 20_000,
    }),
  })
  await call(`/vehicles/${vehicle.id}/insurance-policies`, {
    method: 'POST',
    body: JSON.stringify({
      providerName: 'Live Insurer',
      startsOn: '2026-03-01',
      premiumAmount: '480.00',
      currency: 'GBP',
    }),
  })
  await call(`/vehicles/${vehicle.id}/road-tax`, {
    method: 'POST',
    body: JSON.stringify({ countryCode: 'GB', startsOn: '2026-04-01', amount: '180.00' }),
  })
  for (const [odometer, amount, month] of [
    [22_000, '70.00', '05'],
    [24_000, '72.00', '07'],
    [26_000, '68.00', '09'],
  ]) {
    await call(`/vehicles/${vehicle.id}/fuel`, {
      method: 'POST',
      body: JSON.stringify({
        filledOn: `2026-${month}-05`,
        odometer,
        quantity: 50,
        quantityUnit: 'LITRES',
        isFullTank: true,
        totalAmount: amount,
      }),
    })
  }
  const full = await report()
  // 600 + 480 + 180 + 70 + 72 + 68
  full.total === '1470.00' && full.entries === 6
    ? ok(`total ${full.total} across ${full.entries} entries`)
    : fail(`total wrong: ${full.total} / ${full.entries}`)

  console.log('\n[3] Every cost source appears exactly once')
  const cats = full.byCategory
    .map((c) => `${c.key}:${c.total}`)
    .sort()
    .join(' ')
  const servicing = full.byCategory.find((c) => c.key === 'servicing')
  cats.includes('servicing:600.00') &&
  cats.includes('insurance:480.00') &&
  cats.includes('tax:180.00') &&
  cats.includes('fuel:210.00') &&
  servicing.share === 40.82
    ? ok(`categories: ${cats}`)
    : fail(`category breakdown wrong: ${cats}`)

  console.log('\n[4] Cost per mile — the question the product exists to answer')
  // 20,000 → 26,000 km = 6,000 km on £1,470.
  full.distance.kilometres === 6000 && full.costPerDistance.perKilometre === '0.245'
    ? ok(
        `£${full.costPerDistance.perKilometre}/km, £${full.costPerDistance.perMile}/mile over 6,000 km`,
      )
    : fail(`cost per distance wrong: ${JSON.stringify(full.costPerDistance)}`)

  console.log('\n[5] Cost per year, not called a projection for a full year')
  full.costPerYear.amount === '1470.00' && full.costPerYear.projected === false
    ? ok(`£${full.costPerYear.amount}/year, measured not projected`)
    : fail(`cost per year wrong: ${JSON.stringify(full.costPerYear)}`)

  console.log('\n[6] Month buckets cover the whole period, gaps included')
  const feb = full.byMonth.find((m) => m.month === '2026-02')
  const jan = full.byMonth.find((m) => m.month === '2026-01')
  full.byMonth.length === 12 && feb.total === '600.00' && jan.total === '0.00'
    ? ok('12 months, empty ones present rather than missing')
    : fail(`months wrong: ${full.byMonth.length}`)

  console.log('\n[7] A short window refuses to be annualised')
  const short = (await (await call('/reports/costs?from=2026-02-01&to=2026-02-14')).json()).data
  short.costPerYear.amount === null && short.costPerYear.unavailableReason === 'PERIOD_TOO_SHORT'
    ? ok('a fortnight is not projected to a year')
    : fail(`short period wrong: ${JSON.stringify(short.costPerYear)}`)

  console.log('\n[8] An odometer correction does not invent distance')
  sql(
    // No updated_at: odometer_entries is append-only, so it carries created_at alone.
    `INSERT INTO odometer_entries
       (workspace_id, vehicle_id, value, unit, recorded_on, source, is_correction, correction_reason)
     VALUES ('${ws}', '${vehicle.id}', 990000, 'KILOMETERS', '2026-06-01', 'MANUAL', true, 'typo');`,
  )
  const afterCorrection = await report()
  afterCorrection.distance.kilometres === 6000
    ? ok('correction excluded; distance unchanged at 6,000 km')
    : fail(`correction leaked into distance: ${afterCorrection.distance.kilometres}`)

  console.log('\n[9] Filtering to one vehicle')
  const other = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({ manufacturer: 'Other', model: 'Car', distanceUnit: 'KILOMETERS' }),
      })
    ).json()
  ).data
  const filtered = await report(`&vehicleId=${other.id}`)
  filtered.total === '0.00'
    ? ok('a vehicle with no costs reports zero, not the workspace total')
    : fail(`filter wrong: ${filtered.total}`)

  console.log('\n[10] Mixed currencies stop every derived figure')
  await call('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      vehicleId: vehicle.id,
      incurredOn: '2026-08-01',
      amount: '30.00',
      currency: 'EUR',
    }),
  })
  const mixed = await report()
  mixed.mixedCurrencies === true &&
  mixed.costPerDistance.unavailableReason === 'MIXED_CURRENCIES' &&
  mixed.costPerYear.unavailableReason === 'MIXED_CURRENCIES'
    ? ok('no total, no per-mile, no per-year — all refused with the same reason')
    : fail(`mixed currency handling wrong: ${JSON.stringify(mixed.costPerYear)}`)
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'service_record_parts',
    'maintenance_completions',
    'maintenance_rules',
    'service_records',
    'insurance_policies',
    'road_tax_records',
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

console.log(process.exitCode ? '\nREPORT VERIFICATION FAILED\n' : '\nCOST REPORTS VERIFIED\n')
