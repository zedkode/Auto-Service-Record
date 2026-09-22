/**
 * RPT-004 end to end: a workspace with three vehicles, read as a fleet.
 *
 * The engine's rules are unit-tested; this proves the live path — that the fleet total
 * matches the cost report to the penny, that compliance is built from the real inspection,
 * policy and tax rows, and that the table renders in a browser.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { chromium } from 'playwright'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const API = 'http://localhost:4100/api/v1'
const DASH = 'http://localhost:3101'
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
const YEAR = `from=${new Date().getUTCFullYear()}-01-01&to=${new Date().getUTCFullYear()}-12-31`

const EMAIL = `fleet-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'FleetLive123!',
    passwordConfirmation: 'FleetLive123!',
    displayName: 'Fleet Live',
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

async function van(model, cost, startMiles, endMiles) {
  const created = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Fleet',
          model,
          distanceUnit: 'MILES',
          currentOdometer: startMiles,
        }),
      })
    ).json()
  ).data
  await call(`/vehicles/${created.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: day(-40),
      title: 'Service',
      totalAmount: cost,
      currency: 'GBP',
      odometer: endMiles,
    }),
  })
  return created.id
}

try {
  console.log('\n[1] Three vans, each with its own costs and mileage')
  const heavy = await van('Heavy', '900.00', 10_000, 19_000)
  const light = await van('Light', '100.00', 5_000, 10_000)
  const idle = await van('Idle', '50.00', 1_000, 1_000)
  const report = (await (await call(`/reports/fleet?${YEAR}`)).json()).data
  check(
    report.fleet.vehicleCount === 3 && report.vehicles.length === 3,
    '3 vehicles in the fleet report',
    `got ${report.vehicles.length}`,
  )

  console.log('\n[2] Ranked by what they cost, with cost per mile for each')
  const rows = Object.fromEntries(report.vehicles.map((v) => [v.vehicleId, v]))
  check(
    report.vehicles[0].vehicleId === heavy,
    `most expensive first: ${report.vehicles[0].displayName}`,
    `expected the heavy van first, got ${report.vehicles[0].displayName}`,
  )
  check(
    rows[heavy].costPerDistance.perMile === '0.100' &&
      rows[light].costPerDistance.perMile === '0.020',
    'per-mile figures correct for both vans that moved',
    `wrong: ${rows[heavy].costPerDistance.perMile} / ${rows[light].costPerDistance.perMile}`,
  )

  console.log('\n[3] A van that did not move says so, rather than dividing by zero')
  check(
    rows[idle].costPerDistance.perMile === null &&
      rows[idle].costPerDistance.unavailableReason === 'NO_MOVEMENT',
    'no cost per mile, reason NO_MOVEMENT',
    `expected NO_MOVEMENT, got ${JSON.stringify(rows[idle].costPerDistance)}`,
  )

  console.log('\n[4] The fleet total agrees with the cost report to the penny')
  const costs = (await (await call(`/reports/costs?${YEAR}`)).json()).data
  check(
    report.fleet.total === costs.total && report.fleet.entries === costs.entries,
    `both report ${costs.total} across ${costs.entries} entries`,
    `fleet ${report.fleet.total}/${report.fleet.entries} vs costs ${costs.total}/${costs.entries}`,
  )

  console.log('\n[5] Compliance comes from the records, and reads the CURRENT MOT')
  await call(`/vehicles/${heavy}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ performedOn: day(-800), expiresOn: day(-435) }),
  })
  await call(`/vehicles/${heavy}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ performedOn: day(-70), expiresOn: day(295) }),
  })
  await call(`/vehicles/${heavy}/road-tax`, {
    method: 'POST',
    body: JSON.stringify({ startsOn: day(-350), expiresOn: day(12), amount: '180.00' }),
  })
  const after = (await (await call(`/reports/fleet?${YEAR}`)).json()).data
  const row = after.vehicles.find((v) => v.vehicleId === heavy)
  check(
    row.compliance.kind === 'TAX' &&
      row.compliance.state === 'DUE_SOON' &&
      row.compliance.daysRemaining === 12,
    'soonest obligation is the tax, due in 12 days — the expired 2024 MOT is ignored',
    `wrong compliance: ${JSON.stringify(row.compliance)}`,
  )
  check(
    after.fleet.needingAttention === 1,
    '1 of 3 needs attention',
    `needingAttention=${after.fleet.needingAttention}`,
  )

  console.log('\n[6] A van with nothing recorded is UNKNOWN, never a green tick')
  check(
    after.vehicles.find((v) => v.vehicleId === light).compliance.state === 'UNKNOWN',
    'UNKNOWN, not OK',
    'a vehicle with no records was reported as compliant',
  )

  console.log('\n[7] A workspace cost is held apart, not spread across the vans')
  await call('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      incurredOn: day(-10),
      amount: '240.00',
      currency: 'GBP',
      description: 'Workshop rent',
    }),
  })
  const withRent = (await (await call(`/reports/fleet?${YEAR}`)).json()).data
  const heavyAfter = withRent.vehicles.find((v) => v.vehicleId === heavy)
  check(
    withRent.unassigned.total === '240.00' && heavyAfter.costPerDistance.perMile === '0.100',
    'workspace cost reported separately; no van’s cost per mile moved',
    `unassigned=${withRent.unassigned.total}, perMile=${heavyAfter.costPerDistance.perMile}`,
  )
  check(
    withRent.fleet.total === '1290.00',
    'the fleet total still includes it',
    `fleet total ${withRent.fleet.total}`,
  )

  console.log('\n[8] Tenant isolation on the new route')
  const strangerEmail = `fleet-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'FleetLive123!',
      passwordConfirmation: 'FleetLive123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const stolen = await fetch(`${API}/workspaces/${ws}/reports/fleet?${YEAR}`, {
    headers: { cookie: sCookie },
  })
  check(stolen.status === 404, '404 for a non-member', `expected 404, got ${stolen.status}`)
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

  console.log('\n[9] It renders, on a desktop and on a phone')
  const browser = await chromium.launch()
  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1280, height: 1000 } })
    ).newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(e.message))
    await page.goto(DASH, { waitUntil: 'networkidle' })
    await page.click('text=Sign in as andrei@autoservices.local')
    await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
    await page.goto(`${DASH}/reports`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Every vehicle compared', { timeout: 15000 })
    const tableRows = await page.locator('table tbody tr').count()
    check(tableRows > 0, `${tableRows} vehicle rows rendered`, 'the fleet table rendered empty')

    // Narrowed to one vehicle, a one-row comparison says nothing and must stand down.
    await page.selectOption('select[name="vehicleId"]', { index: 1 })
    await page.waitForTimeout(1200)
    check(
      (await page.locator('text=Every vehicle compared').count()) === 0 &&
        (await page.locator('text="By vehicle"').count()) === 1,
      'filtered to one vehicle: the comparison gives way to the simple breakdown',
      'the fleet table stayed on screen after filtering to one vehicle',
    )

    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`${DASH}/reports`, { waitUntil: 'networkidle' })
    await page.waitForSelector('text=Every vehicle compared', { timeout: 15000 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    check(!overflow, 'no horizontal scroll at 375px', 'HORIZONTAL SCROLL at 375px')
    check(pageErrors.length === 0, 'no page errors', `page errors: ${pageErrors.slice(0, 2)}`)
  } finally {
    await browser.close()
  }
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'inspection_advisories',
    'vehicle_inspections',
    'insurance_policies',
    'road_tax_records',
    'service_record_parts',
    'maintenance_completions',
    'maintenance_rules',
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
  errs.length ? `\nFLEET VERIFICATION FAILED (${errs.length})\n` : '\nFLEET REPORT VERIFIED\n',
)
