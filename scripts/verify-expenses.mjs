/**
 * OWN-007/008 end to end against the RUNNING stack.
 *
 * The rule under test is the one that makes every cost figure trustworthy: `expenses` is
 * the single cost surface, and a service must be counted once — through its projection —
 * never twice (DATABASE.md §4.8).
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

const EMAIL = `exp-live-${Date.now()}@example.com`
const today = new Date().toISOString().slice(0, 10)

const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'ExpenseLive123!',
    passwordConfirmation: 'ExpenseLive123!',
    displayName: 'Expense Live',
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
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Ford',
          model: 'Mondeo',
          distanceUnit: 'MILES',
          currentOdometer: 100000,
        }),
      })
    ).json()
  ).data

  console.log('\n[1] A service with a total projects into the ledger')
  const service = (
    await (
      await call(`/vehicles/${vehicle.id}/services`, {
        method: 'POST',
        body: JSON.stringify({
          performedOn: today,
          title: 'Full service',
          totalAmount: '450.00',
          currency: 'GBP',
          workshopName: 'Live Test Garage',
        }),
      })
    ).json()
  ).data
  const ledger = await (await call(`/expenses?vehicleId=${vehicle.id}`)).json()
  const projected = ledger.data.find((e) => e.sourceRecordId === service.id)
  projected?.amount === '450.00' && projected.isProjected === true
    ? ok(`service appears once as a projected cost of ${projected.amount}`)
    : fail(`expected one projected £450.00 row, got ${JSON.stringify(ledger.data)}`)

  console.log('\n[2] Editing the service updates that row, it does not add another')
  await call(`/services/${service.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ totalAmount: '525.00' }),
  })
  const count = sql(
    `SELECT count(*) FROM expenses WHERE source_type='SERVICE' AND source_record_id='${service.id}' AND deleted_at IS NULL;`,
  )
  const amount = sql(
    `SELECT amount FROM expenses WHERE source_type='SERVICE' AND source_record_id='${service.id}' AND deleted_at IS NULL;`,
  )
  count === '1' && amount === '525.00'
    ? ok('still exactly one row, now 525.00')
    : fail(`expected 1 row at 525.00; got ${count} row(s) at ${amount}`)

  console.log('\n[3] Insurance and road tax project too')
  await call(`/vehicles/${vehicle.id}/insurance-policies`, {
    method: 'POST',
    body: JSON.stringify({
      providerName: 'Live Insurer',
      startsOn: today,
      premiumAmount: '620.00',
      currency: 'GBP',
    }),
  })
  await call(`/vehicles/${vehicle.id}/road-tax`, {
    method: 'POST',
    body: JSON.stringify({ countryCode: 'GB', startsOn: today, amount: '180.00' }),
  })
  const kinds = sql(
    `SELECT string_agg(DISTINCT source_type::text, ',' ORDER BY source_type::text)
       FROM expenses WHERE workspace_id='${ws}' AND deleted_at IS NULL;`,
  )
  kinds === 'INSURANCE,SERVICE,TAX'
    ? ok(`ledger carries: ${kinds}`)
    : fail(`unexpected sources: "${kinds}"`)

  console.log('\n[4] A manual cost sits alongside them')
  await call('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      vehicleId: vehicle.id,
      incurredOn: today,
      amount: '42.50',
      currency: 'GBP',
      vendorName: 'Car wash',
      description: 'Valet',
    }),
  })
  const summary = (await (await call(`/expenses/summary?from=${today}&to=${today}`)).json()).data
  // 525.00 + 620.00 + 180.00 + 42.50
  summary.total === '1367.50'
    ? ok(`summary totals ${summary.total} with no double counting`)
    : fail(`expected 1367.50, got ${summary.total}`)

  console.log('\n[5] The service is NOT counted twice')
  const serviceRows = sql(
    `SELECT count(*) FROM expenses WHERE workspace_id='${ws}' AND source_type='SERVICE' AND deleted_at IS NULL;`,
  )
  serviceRows === '1'
    ? ok('one service, one cost row')
    : fail(`${serviceRows} service rows in the ledger`)

  console.log('\n[6] A projected row cannot be edited by hand')
  const proj = sql(
    `SELECT id FROM expenses WHERE workspace_id='${ws}' AND source_type='SERVICE' AND deleted_at IS NULL LIMIT 1;`,
  )
  const refused = await call(`/expenses/${proj}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount: '1.00' }),
  })
  const msg = (await refused.json()).error?.message ?? ''
  refused.status === 422 && /service record/i.test(msg)
    ? ok(`refused with a useful reason: "${msg}"`)
    : fail(`expected a 422 explaining where to edit; got ${refused.status} "${msg}"`)

  console.log('\n[7] The dashboard reports real money, not a mock')
  const dash = (await (await call('/dashboard')).json()).data
  dash.costs.thisMonth === '1367.50' && dash.costs.currency === 'GBP'
    ? ok(`dashboard spend: ${dash.costs.thisMonth} ${dash.costs.currency}`)
    : fail(`dashboard costs wrong: ${JSON.stringify(dash.costs)}`)

  console.log('\n[8] Mixed currencies are refused, not silently added')
  await call('/expenses', {
    method: 'POST',
    body: JSON.stringify({
      vehicleId: vehicle.id,
      incurredOn: today,
      amount: '30.00',
      currency: 'EUR',
    }),
  })
  const dash2 = (await (await call('/dashboard')).json()).data
  dash2.costs.mixedCurrencies === true && dash2.costs.thisMonth === null
    ? ok('mixed currencies reported as such rather than summed')
    : fail(`expected mixedCurrencies; got ${JSON.stringify(dash2.costs)}`)

  console.log('\n[9] Deleting the service withdraws its cost')
  await call(`/services/${service.id}`, { method: 'DELETE' })
  const after = sql(
    `SELECT count(*) FROM expenses WHERE source_type='SERVICE' AND source_record_id='${service.id}' AND deleted_at IS NULL;`,
  )
  after === '0' ? ok('cost withdrawn with the service') : fail(`${after} row(s) left behind`)

  console.log('\n[10] The dashboard now reflects real obligations, not hardcoded zeros')
  await call(`/vehicles/${vehicle.id}/road-tax`, {
    method: 'POST',
    body: JSON.stringify({
      countryCode: 'GB',
      startsOn: '2024-01-01',
      expiresOn: '2025-01-01',
      amount: '150.00',
    }),
  })
  const dash3 = (await (await call('/dashboard')).json()).data
  const overdueItem = dash3.attention.find((a) => a.severity === 'OVERDUE')
  overdueItem
    ? ok(`attention panel surfaces "${overdueItem.title}" (${dash3.counts.overdue} overdue)`)
    : fail(`expired road tax not surfaced: ${JSON.stringify(dash3.counts)}`)
} finally {
  const wsq = `(SELECT id FROM workspaces WHERE owner_user_id IN (SELECT id FROM users WHERE email='${EMAIL}'))`
  sql(`DELETE FROM expenses WHERE workspace_id IN ${wsq};`)
  sql(`DELETE FROM reminders WHERE workspace_id IN ${wsq};`)
  sql(`DELETE FROM notifications WHERE workspace_id IN ${wsq};`)
}

console.log(process.exitCode ? '\nEXPENSE VERIFICATION FAILED\n' : '\nEXPENSE LEDGER VERIFIED\n')
