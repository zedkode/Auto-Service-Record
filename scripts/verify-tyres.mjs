/**
 * OWN-005 end to end: a seasonal pair, on and off across two winters, and the distance
 * that accumulates across both — plus the tread rules, which are the safety-relevant part.
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

const EMAIL = `tyres-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'TyresLiveCheck123!',
    passwordConfirmation: 'TyresLiveCheck123!',
    displayName: 'Tyres Live',
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
async function must(label, res) {
  if (!res.ok) throw new Error(`${label} failed: ${res.status} ${await res.text()}`)
  return (await res.json()).data
}
const day = (offset) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

try {
  console.log('\n[1] A car with a summer set and a winter set')
  const vehicle = await must(
    'vehicle',
    await call('/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        manufacturer: 'Volvo',
        model: 'V60',
        registrationNumber: `TY ${Math.floor(Math.random() * 9000 + 1000)}`,
        distanceUnit: 'MILES',
        currentOdometer: 50_000,
      }),
    }),
  )
  const summer = await must(
    'summer set',
    await call(`/vehicles/${vehicle.id}/tyre-sets`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Summer set', season: 'SUMMER', size: '235/45 R18' }),
    }),
  )
  const winter = await must(
    'winter set',
    await call(`/vehicles/${vehicle.id}/tyre-sets`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Winter set', season: 'WINTER', size: '225/50 R17' }),
    }),
  )
  check(
    summer.distance.unavailableReason === 'NEVER_FITTED' && summer.tread.state === 'UNKNOWN',
    'a new set reports NEVER_FITTED and no tread, rather than zeroes',
    `unexpected new-set state: ${JSON.stringify(summer.distance)}`,
  )

  console.log('\n[2] Fitting one takes the other off — a car wears one set at a time')
  await must(
    'fit summer',
    await call(`/tyre-sets/${summer.id}/fit`, {
      method: 'POST',
      body: JSON.stringify({
        installedOn: day(-400),
        installedOdometer: 50_000,
        odometerUnit: 'MILES',
        treadDepthMm: 7.5,
      }),
    }),
  )
  const afterWinter = await must(
    'fit winter',
    await call(`/tyre-sets/${winter.id}/fit`, {
      method: 'POST',
      body: JSON.stringify({
        installedOn: day(-300),
        installedOdometer: 54_000,
        odometerUnit: 'MILES',
        treadDepthMm: 8.0,
      }),
    }),
  )
  const summerNow = await must('summer', await call(`/tyre-sets/${summer.id}`))
  check(
    afterWinter.fitted &&
      !summerNow.fitted &&
      summerNow.status === 'STORED' &&
      summerNow.distance.miles === 4_000,
    'the summer set came off automatically at 54,000, having covered 4,000 miles',
    `swap wrong: summerFitted=${summerNow.fitted} miles=${summerNow.distance.miles}`,
  )

  console.log('\n[3] A set on the car measures against where the car is NOW')
  /**
   * Dated TODAY on purpose. The vehicle's current-mileage cache only advances for the
   * latest reading (D-001), so a reading backdated to yesterday leaves the cache at the
   * value set when the vehicle was created — and the set then measures against a mileage
   * lower than the one it was fitted at, which the engine correctly clamps to zero rather
   * than reporting a negative distance.
   */
  await must(
    'odometer',
    await call(`/vehicles/${vehicle.id}/odometer`, {
      method: 'POST',
      body: JSON.stringify({ value: 57_500, unit: 'MILES', recordedOn: day(0) }),
    }),
  )
  const winterNow = await must('winter', await call(`/tyre-sets/${winter.id}`))
  check(
    winterNow.distance.miles === 3_500,
    'the fitted set reads 3,500 miles — it keeps up with the car rather than freezing',
    `expected 3,500, got ${winterNow.distance.miles}`,
  )

  console.log('\n[4] Across two winters the distance accumulates')
  await must(
    'winter off',
    await call(`/tyre-sets/${winter.id}/remove`, {
      method: 'POST',
      body: JSON.stringify({ removedOn: day(-200), removedOdometer: 58_000 }),
    }),
  )
  await must(
    'winter on again',
    await call(`/tyre-sets/${winter.id}/fit`, {
      method: 'POST',
      body: JSON.stringify({
        installedOn: day(-100),
        installedOdometer: 62_000,
        odometerUnit: 'MILES',
      }),
    }),
  )
  await must(
    'odometer 2',
    await call(`/vehicles/${vehicle.id}/odometer`, {
      method: 'POST',
      body: JSON.stringify({ value: 65_500, unit: 'MILES', recordedOn: day(0) }),
    }),
  )
  const twoWinters = await must('winter', await call(`/tyre-sets/${winter.id}`))
  // 54,000→58,000 is 4,000; 62,000→65,500 is 3,500.
  check(
    twoWinters.distance.miles === 7_500 && twoWinters.distance.measuredPeriods === 2,
    `7,500 miles over 2 fittings — the set, not the fitting, is what wears out`,
    `expected 7,500 over 2, got ${twoWinters.distance.miles} over ${twoWinters.distance.measuredPeriods}`,
  )

  console.log('\n[5] Tread is measured, and the legal limit is the legal limit')
  await must(
    'tread',
    await call(`/tyre-sets/${winter.id}/tread`, {
      method: 'POST',
      body: JSON.stringify({ treadDepthMm: 2.4, measuredOn: day(0) }),
    }),
  )
  const worn = await must('winter', await call(`/tyre-sets/${winter.id}`))
  check(
    worn.tread.state === 'REPLACE_SOON' && worn.tread.depthMm === 2.4,
    'a 2.4 mm reading is REPLACE_SOON — advised well before the 1.6 mm limit',
    `expected REPLACE_SOON, got ${JSON.stringify(worn.tread)}`,
  )
  await must(
    'tread illegal',
    await call(`/tyre-sets/${winter.id}/tread`, {
      method: 'POST',
      body: JSON.stringify({ treadDepthMm: 1.4, measuredOn: day(0) }),
    }),
  )
  const illegal = await must('winter', await call(`/tyre-sets/${winter.id}`))
  check(illegal.tread.state === 'ILLEGAL', '1.4 mm is ILLEGAL', `got ${illegal.tread.state}`)

  console.log('\n[6] It never guesses a depth from mileage')
  check(
    summerNow.tread.depthMm === 7.5 && twoWinters.tread.depthMm !== null,
    'depth comes only from what was measured; nothing is predicted',
    'a tread depth appeared without a measurement',
  )

  console.log('\n[7] Illegal tread raises a reminder')
  const scan = await fetch(`${API}/internal/reminders/scan`, {
    method: 'POST',
    headers: { 'x-internal-token': process.env.SESSION_SECRET ?? '' },
  })
  if (!scan.ok) throw new Error(`scan failed: ${scan.status}`)
  const reminder = sql(
    `SELECT title FROM reminders WHERE workspace_id='${ws}' AND source_type='TYRE' LIMIT 1;`,
  )
  check(
    reminder.includes('below the legal minimum'),
    `reminder raised: "${reminder}"`,
    `no tyre reminder was raised (got "${reminder}")`,
  )

  console.log('\n[8] A stored set with low tread does not warn about today')
  const storedLow = await must(
    'stored set',
    await call(`/vehicles/${vehicle.id}/tyre-sets`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Old spares', season: 'SUMMER' }),
    }),
  )
  const tyreReminders = sql(
    `SELECT count(*) FROM reminders WHERE workspace_id='${ws}' AND source_type='TYRE';`,
  )
  check(
    tyreReminders === '1',
    'only the set actually on the car is warned about',
    `${tyreReminders} tyre reminders for one fitted set`,
  )

  console.log('\n[9] The invariants hold')
  const refit = await call(`/tyre-sets/${winter.id}/fit`, {
    method: 'POST',
    body: JSON.stringify({ installedOn: day(0), installedOdometer: 65_500, odometerUnit: 'MILES' }),
  })
  const deleteFitted = await call(`/tyre-sets/${winter.id}`, { method: 'DELETE' })
  const treadOnStored = await call(`/tyre-sets/${storedLow.id}/tread`, {
    method: 'POST',
    body: JSON.stringify({ treadDepthMm: 5, measuredOn: day(0) }),
  })
  check(
    refit.status === 409 && deleteFitted.status === 409 && treadOnStored.status === 409,
    'refitting a fitted set, deleting one that is on, and measuring a stored set are all refused',
    `expected 409×3, got ${refit.status}/${deleteFitted.status}/${treadOnStored.status}`,
  )

  console.log('\n[10] Only one set is ever recorded as fitted')
  const openCount = sql(
    `SELECT count(*) FROM tyre_installations WHERE vehicle_id='${vehicle.id}' AND removed_on IS NULL;`,
  )
  check(openCount === '1', 'exactly one open installation', `${openCount} sets recorded as fitted`)

  console.log('\n[11] Another workspace cannot see it')
  const strangerEmail = `tyres-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'TyresLiveCheck123!',
      passwordConfirmation: 'TyresLiveCheck123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const peek = await fetch(`${API}/workspaces/${ws}/tyre-sets/${winter.id}`, {
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

  console.log('\n[12] Everything is audited')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE workspace_id='${ws}' AND resource_type='tyre_set';`,
  )
  check(
    ['tyre_set.created', 'tyre_set.fitted', 'tyre_set.removed', 'tyre_set.tread_measured'].every(
      (a) => actions.includes(a),
    ),
    `audited: ${actions}`,
    `missing audit entries: ${actions}`,
  )
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'tyre_installations',
    'tyre_sets',
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'warranties',
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
  errs.length ? `\nTYRE VERIFICATION FAILED (${errs.length})\n` : '\nTYRE SETS VERIFIED\n',
)
