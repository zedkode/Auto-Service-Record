/**
 * VEH-003 end to end: prove that selling, archiving and deleting a vehicle all leave its
 * history intact — the thing this product exists to protect (DATABASE.md §5).
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
    ['exec', '-i', 'autoservices-postgres', 'psql', '-U', 'autoservices', '-d', 'autoservices',
     '-tAc', q],
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

const EMAIL = `veh-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'LifecycleLive123!',
    passwordConfirmation: 'LifecycleLive123!',
    displayName: 'Lifecycle Live',
    acceptTerms: true,
  }),
})
if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
const cookie = (reg.headers.getSetCookie?.()[0] ?? reg.headers.get('set-cookie') ?? '').split(';')[0]
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

const history = (id) =>
  sql(
    `SELECT
       (SELECT count(*) FROM service_records WHERE vehicle_id='${id}') || '/' ||
       (SELECT count(*) FROM fuel_entries    WHERE vehicle_id='${id}') || '/' ||
       (SELECT count(*) FROM odometer_entries WHERE vehicle_id='${id}') || '/' ||
       (SELECT count(*) FROM vehicle_inspections WHERE vehicle_id='${id}');`,
  )

try {
  console.log('\n[1] A vehicle with a real history behind it')
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Ford',
          model: 'Mondeo',
          registrationNumber: 'LIF 001',
          distanceUnit: 'KILOMETERS',
        }),
      })
    ).json()
  ).data
  await call(`/vehicles/${vehicle.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: '2026-02-10',
      title: 'Major service',
      totalAmount: '450.00',
      currency: 'GBP',
      odometer: 10_000,
    }),
  })
  await call(`/vehicles/${vehicle.id}/fuel`, {
    method: 'POST',
    body: JSON.stringify({
      filledOn: '2026-03-01',
      odometer: 11_000,
      quantity: 50,
      quantityUnit: 'LITRES',
      isFullTank: true,
      totalAmount: '70.00',
    }),
  })
  await call(`/vehicles/${vehicle.id}/inspections`, {
    method: 'POST',
    body: JSON.stringify({ performedOn: '2026-01-15', expiresOn: '2027-01-14' }),
  })
  const before = history(vehicle.id)
  ok(`history: ${before} (services/fuel/odometer/inspections)`)

  console.log('\n[2] Selling it keeps every record')
  const sold = await call(`/vehicles/${vehicle.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'SOLD', reason: 'Sold to a dealer' }),
  })
  sold.status === 200 && history(vehicle.id) === before
    ? ok('status SOLD, history byte-for-byte unchanged')
    : fail(`sale changed the history: ${before} -> ${history(vehicle.id)}`)

  console.log('\n[3] It leaves the garage view but stays readable')
  const garage = (await (await call('/vehicles')).json()).data
  const detail = await call(`/vehicles/${vehicle.id}`)
  const withInactive = (await (await call('/vehicles?includeInactive=true')).json()).data
  !garage.some((v) => v.id === vehicle.id) &&
  detail.status === 200 &&
  withInactive.some((v) => v.id === vehicle.id)
    ? ok('hidden from the garage, still openable, listed with includeInactive')
    : fail('visibility rules wrong after sale')

  console.log('\n[4] A sold car stops asking for an MOT')
  sql(
    `INSERT INTO reminders (workspace_id, vehicle_id, source_type, source_id, title, status, updated_at)
     VALUES ('${ws}', '${vehicle.id}', 'INSPECTION', '${vehicle.id}', 'MOT expires soon', 'DUE', now());`,
  )
  await call(`/vehicles/${vehicle.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACTIVE' }),
  })
  await call(`/vehicles/${vehicle.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'SOLD' }),
  })
  const open = sql(
    `SELECT count(*) FROM reminders WHERE vehicle_id='${vehicle.id}' AND status <> 'CANCELLED';`,
  )
  open === '0' ? ok('open reminders cancelled') : fail(`${open} reminder(s) still open`)

  console.log('\n[5] Removing one entered in error hides it without destroying it')
  const removed = await call(`/vehicles/${vehicle.id}`, { method: 'DELETE' })
  // `::text` on a boolean yields 'true'/'false' — psql's 't'/'f' is only its display form.
  const row = sql(
    `SELECT (deleted_at IS NOT NULL)::text FROM vehicles WHERE id='${vehicle.id}';`,
  )
  removed.status === 204 && row === 'true' && history(vehicle.id) === before
    ? ok('row retained with deleted_at set; history untouched')
    : fail(`delete wrong: ${removed.status}, deleted=${row}`)

  console.log('\n[6] Its costs leave the reports with it')
  const report = (await (await call('/reports/costs?from=2026-01-01&to=2026-12-31')).json()).data
  report.total === '0.00'
    ? ok('a hidden vehicle no longer inflates the totals')
    : fail(`deleted vehicle still counted: ${report.total}`)

  console.log('\n[7] It can be found and restored')
  const deleted = (await (await call('/vehicles/deleted')).json()).data
  const restored = await call(`/vehicles/${vehicle.id}/restore`, { method: 'POST' })
  const afterRestore = await call(`/vehicles/${vehicle.id}`)
  deleted.some((v) => v.id === vehicle.id) &&
  restored.status === 201 &&
  afterRestore.status === 200 &&
  history(vehicle.id) === before
    ? ok('restored with a complete record, not an empty shell')
    : fail('restore did not return the vehicle intact')

  console.log('\n[8] And its costs come back too')
  const back = (await (await call('/reports/costs?from=2026-01-01&to=2026-12-31')).json()).data
  back.total === '520.00'
    ? ok(`costs returned: ${back.total}`)
    : fail(`expected 520.00 after restore, got ${back.total}`)

  console.log('\n[9] No user action ever hard-deletes a vehicle')
  const stillThere = sql(`SELECT count(*) FROM vehicles WHERE id='${vehicle.id}';`)
  stillThere === '1'
    ? ok('the row survived every operation in this run')
    : fail('a vehicle row was removed outright')

  console.log('\n[10] Everything is audited')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE resource_id='${vehicle.id}' AND resource_type='vehicle';`,
  )
  const wanted = ['vehicle.status_changed', 'vehicle.deleted', 'vehicle.restored']
  wanted.every((a) => actions.includes(a))
    ? ok(`audited: ${actions}`)
    : fail(`missing audit entries: ${actions}`)
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'expenses', 'odometer_entries', 'fuel_entries', 'service_record_parts',
    'maintenance_completions', 'maintenance_rules', 'service_records',
    'inspection_advisories', 'vehicle_inspections', 'insurance_policies',
    'road_tax_records', 'reminders', 'notifications', 'audit_logs',
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

console.log(process.exitCode ? '\nLIFECYCLE VERIFICATION FAILED\n' : '\nVEHICLE LIFECYCLE VERIFIED\n')
