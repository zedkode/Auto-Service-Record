/**
 * OWN-006 end to end against the RUNNING stack, and the closing of OWN-008: with fuel
 * projecting into the ledger, every cost source a vehicle has now lands in one place.
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

const EMAIL = `fuel-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'FuelLive123!',
    passwordConfirmation: 'FuelLive123!',
    displayName: 'Fuel Live',
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

  const fillUp = (odometer, quantity, over = {}) =>
    call(`/vehicles/${vehicle.id}/fuel`, {
      method: 'POST',
      body: JSON.stringify({
        filledOn: '2026-09-01',
        odometer,
        quantity,
        quantityUnit: 'LITRES',
        isFullTank: true,
        ...over,
      }),
    })

  console.log('\n[1] Before any fill, the product says why it cannot tell you')
  const empty = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  empty.average === null && empty.unavailableReason === 'NO_FILLS'
    ? ok('no invented figure; reason is NO_FILLS')
    : fail(`unexpected: ${JSON.stringify(empty)}`)

  console.log('\n[2] One full fill is still not enough')
  await fillUp(10_000, 50, { totalAmount: '70.00', stationName: 'Shell' })
  const one = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  one.average === null && one.unavailableReason === 'ONE_FULL_FILL'
    ? ok('correctly waits for the second full tank')
    : fail(`unexpected: ${JSON.stringify(one.unavailableReason)}`)

  console.log('\n[3] The fill became a mileage reading')
  const odo = sql(
    `SELECT value || ':' || source FROM odometer_entries
      WHERE vehicle_id='${vehicle.id}' AND source='FUEL' LIMIT 1;`,
  )
  const current = sql(`SELECT current_odometer FROM vehicles WHERE id='${vehicle.id}';`)
  odo === '10000:FUEL' && current === '10000'
    ? ok('mileage history updated and attributed to the fill')
    : fail(`odometer wrong: ${odo} / ${current}`)

  console.log('\n[4] A second full fill produces a figure')
  await fillUp(10_500, 50, { totalAmount: '69.00' })
  const two = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  two.average?.litresPer100Km === 10
    ? ok(`10 L/100km over 500 km, ${two.average.milesPerImperialGallon} mpg`)
    : fail(`economy wrong: ${JSON.stringify(two.average)}`)

  console.log('\n[5] A partial fill counts towards the next full tank, never on its own')
  await fillUp(10_700, 20, { isFullTank: false, totalAmount: '28.00' })
  const afterPartial = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  await fillUp(11_000, 30, { totalAmount: '42.00' })
  const afterFull = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  const last = afterFull.intervals[afterFull.intervals.length - 1]
  afterPartial.intervals.length === 1 && last.quantity === 50 && last.fillCount === 2
    ? ok('partial folded into the 10,500 → 11,000 interval: 50 litres across 2 fills')
    : fail(`partial handling wrong: ${JSON.stringify(last)}`)

  console.log('\n[6] A missed fill excludes its interval rather than reporting a wild figure')
  await fillUp(11_600, 90, { missedFill: true, totalAmount: '126.00' })
  const withMissed = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  const skipped = withMissed.skipped.some((s) => s.reason === 'MISSED_FILL')
  skipped && withMissed.average.litresPer100Km === 10
    ? ok('interval excluded; the average is unaffected by the broken chain')
    : fail(`missed fill mishandled: ${JSON.stringify(withMissed.skipped)}`)

  console.log('\n[7] OWN-008 closes: fuel reaches the expense ledger')
  const sources = sql(
    `SELECT string_agg(DISTINCT source_type::text, ',' ORDER BY source_type::text)
       FROM expenses WHERE workspace_id='${ws}' AND deleted_at IS NULL;`,
  )
  const fuelTotal = sql(
    `SELECT COALESCE(sum(amount),0)::text FROM expenses
       WHERE workspace_id='${ws}' AND source_type='FUEL' AND deleted_at IS NULL;`,
  )
  // 70 + 69 + 28 + 42 + 126
  sources === 'FUEL' && Number(fuelTotal) === 335
    ? ok(`every fill projected; fuel spend ${fuelTotal}`)
    : fail(`ledger wrong: sources=${sources} total=${fuelTotal}`)

  console.log('\n[8] Editing a fill updates its cost, it does not add a second')
  const entryId = sql(
    `SELECT id FROM fuel_entries WHERE vehicle_id='${vehicle.id}' AND odometer=10000;`,
  )
  await call(`/fuel/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ totalAmount: '75.00' }),
  })
  const rows = sql(
    `SELECT count(*) || ':' || sum(amount)::text FROM expenses
       WHERE source_type='FUEL' AND source_record_id='${entryId}' AND deleted_at IS NULL;`,
  )
  rows === '1:75.00' ? ok('one row, updated to 75.00') : fail(`expected 1:75.00, got ${rows}`)

  console.log('\n[9] The dashboard now counts fuel in the month’s spend')
  const dash = (await (await call('/dashboard')).json()).data
  Number(dash.costs.thisMonth) > 0 || dash.costs.entries > 0
    ? ok(`dashboard sees ${dash.costs.entries} cost entr(ies)`)
    : fail(`dashboard costs: ${JSON.stringify(dash.costs)}`)

  console.log('\n[10] An electric vehicle uses the same logic in kWh')
  const ev = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Nissan',
          model: 'Leaf',
          distanceUnit: 'KILOMETERS',
          fuelType: 'ELECTRIC',
        }),
      })
    ).json()
  ).data
  for (const [odometer, quantity] of [
    [0, 40],
    [200, 40],
  ]) {
    await call(`/vehicles/${ev.id}/fuel`, {
      method: 'POST',
      body: JSON.stringify({
        filledOn: '2026-09-01',
        odometer,
        quantity,
        quantityUnit: 'KWH',
        isFullTank: true,
      }),
    })
  }
  const evEconomy = (await (await call(`/vehicles/${ev.id}/fuel/economy`)).json()).data
  evEconomy.average?.kwhPer100Km === 20 && evEconomy.average.litresPer100Km === null
    ? ok(`${evEconomy.average.kwhPer100Km} kWh/100km; no litres invented for an EV`)
    : fail(`EV economy wrong: ${JSON.stringify(evEconomy.average)}`)
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  sql(`DELETE FROM expenses WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM odometer_entries WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM fuel_entries WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM reminders WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM notifications WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM audit_logs WHERE workspace_id IN ${wq} OR actor_user_id IN ${uq};`)
  sql(`DELETE FROM vehicles WHERE workspace_id IN ${wq};`)
  sql(`DELETE FROM workspace_members WHERE workspace_id IN ${wq} OR user_id IN ${uq};`)
  sql(`DELETE FROM workspaces WHERE id IN ${wq};`)
  sql(`DELETE FROM sessions WHERE user_id IN ${uq};`)
  sql(`DELETE FROM user_profiles WHERE user_id IN ${uq};`)
  sql(`DELETE FROM email_verification_tokens WHERE user_id IN ${uq};`)
  sql(`DELETE FROM users WHERE email='${EMAIL}';`)
}

console.log(process.exitCode ? '\nFUEL VERIFICATION FAILED\n' : '\nFUEL AND ECONOMY VERIFIED\n')
