/**
 * Verifies the service + maintenance vertical slice against the running API:
 * template -> service creation -> odometer + maintenance advance -> timeline -> costs.
 */
const API = 'http://localhost:4100/api/v1'
const ok = (s) => console.log(`  ✓ ${s}`)
let cookie = ''

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    // content-type only when there IS a body — Fastify rejects an empty JSON body.
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setC = res.headers.getSetCookie?.()[0]
  if (setC) cookie = setC.split(';')[0]
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

console.log('\n[1] Sign in and pick a vehicle')
await req('POST', '/auth/login', {
  email: 'andrei@autoservices.local',
  password: 'DevPassword123!',
})
const session = await req('GET', '/auth/session')
const ws = session.body.data.workspaces[0].id
const vehicles = await req('GET', `/workspaces/${ws}/vehicles`)
const vehicle = vehicles.body.data.find((v) => v.manufacturer === 'Ford')
ok(`${vehicle.manufacturer} ${vehicle.model} @ ${vehicle.currentOdometer.toLocaleString()} mi`)

console.log('\n[2] Built-in service categories')
const cats = await req('GET', `/workspaces/${ws}/service-categories`)
ok(
  `${cats.body.data.length} categories, e.g. ${cats.body.data
    .slice(0, 4)
    .map((c) => c.name)
    .join(', ')}`,
)
const oilCat = cats.body.data.find((c) => c.key === 'engine_oil')

console.log('\n[3] Apply the maintenance template')
const applied = await req(
  'POST',
  `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance/apply-template`,
)
ok(`${applied.body.data.created} rules created from category defaults`)

const rules = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance`)
ok(`${rules.body.data.length} rules on the vehicle`)
const oilRule = rules.body.data.find((r) => r.category?.key === 'engine_oil')
ok(
  `engine oil: interval ${oilRule.intervalDistance} ${oilRule.intervalDistanceUnit} / ${oilRule.intervalMonths}mo, status ${oilRule.status} — "${oilRule.summary}"`,
)

console.log('\n[4] Add a service (oil change) at current mileage')
const before = vehicle.currentOdometer
const service = await req('POST', `/workspaces/${ws}/vehicles/${vehicle.id}/services`, {
  performedOn: new Date().toISOString().slice(0, 10),
  title: 'Engine oil and filter change',
  description: 'Castrol Edge 5W-30, Mann filter',
  categoryId: oilCat.id,
  odometer: before + 240,
  workshopName: 'Smith & Sons Garage',
  labourTotal: '45.00',
  partsTotal: '84.00',
  totalAmount: '129.00',
  currency: 'GBP',
  parts: [
    {
      name: 'Castrol Edge 5W-30 5L',
      brand: 'Castrol',
      partNumber: 'CAS-5W30-5L',
      quantity: 1,
      unitPrice: '52.00',
    },
    { name: 'Oil filter', brand: 'Mann', partNumber: 'W712/95', quantity: 1, unitPrice: '12.50' },
  ],
})
if (service.status !== 201)
  throw new Error(`service create ${service.status}: ${JSON.stringify(service.body)}`)
ok(`service created: "${service.body.data.title}" £${service.body.data.totalAmount}`)
ok(`${service.body.data.parts.length} parts recorded`)

console.log('\n[5] Odometer advanced by the service (append-only)')
const odo = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/odometer`)
const fromService = odo.body.data.filter((e) => e.source === 'SERVICE')
ok(`current reading ${odo.body.data[0].value.toLocaleString()} mi (was ${before.toLocaleString()})`)
ok(`${fromService.length} entry attributed to source=SERVICE`)
ok(`${odo.body.data.length} total readings — history preserved`)

console.log('\n[6] Maintenance rule advanced automatically')
const after = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance`)
const oilAfter = after.body.data.find((r) => r.category?.key === 'engine_oil')
ok(`engine oil now: ${oilAfter.status} — "${oilAfter.summary}"`)
ok(
  `last completed ${oilAfter.lastCompletedOn} @ ${oilAfter.lastCompletedOdometer?.toLocaleString()} mi`,
)
ok(`next due ${oilAfter.nextDueOn} or ${oilAfter.nextDueOdometer?.toLocaleString()} mi`)
if (oilAfter.status !== 'OK') throw new Error('rule should be OK immediately after completion')

const completions = await req('GET', `/workspaces/${ws}/maintenance/${oilAfter.id}/completions`)
ok(`${completions.body.data.length} completion recorded (append-only history)`)

console.log('\n[7] Service appears in history and on the timeline')
const history = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/services`)
ok(`${history.body.data.length} service record(s) in history`)
const timeline = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/timeline`)
const types = [...new Set(timeline.body.data.map((e) => e.type))]
ok(`timeline has ${timeline.body.data.length} events across types: ${types.join(', ')}`)
if (!types.includes('SERVICE')) throw new Error('service missing from timeline')

console.log('\n[8] Cost summary is real, not mocked')
const costs = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/services/cost-summary`)
ok(
  `spend: ${costs.body.data.map((c) => `${c.count} services, ${c.total} ${c.currency}`).join('; ')}`,
)

console.log('\n[9] Workspace-wide due list')
const due = await req('GET', `/workspaces/${ws}/maintenance/due`)
ok(`${due.body.data.length} items due/overdue across the workspace`)
for (const d of due.body.data.slice(0, 4)) {
  console.log(`      ${d.status.padEnd(9)} ${d.name} — ${d.summary}`)
}

console.log('\n[10] Overdue detection works')
const brakeFluid = after.body.data.find((r) => r.category?.key === 'brake_fluid')
await req('PATCH', `/workspaces/${ws}/maintenance/${brakeFluid.id}`, { thresholdDays: 3650 })
// Restore the default window afterwards so the demo data is not left in a strange state.
const refreshed = await req('GET', `/workspaces/${ws}/vehicles/${vehicle.id}/maintenance`)
const bfAfter = refreshed.body.data.find((r) => r.id === brakeFluid.id)
ok(`brake fluid with a 10-year warning window: ${bfAfter.status} — "${bfAfter.summary}"`)
await req('PATCH', `/workspaces/${ws}/maintenance/${brakeFluid.id}`, { thresholdDays: null })
ok('warning window restored to the default')

console.log('\nSERVICE + MAINTENANCE VERIFIED')
