/**
 * RPT-003 end to end: eight months of fills on a car that gets steadily thirstier, and the
 * product noticing. Proves the whole path — fills in, intervals computed, months bucketed,
 * a verdict with its caveats out — against the running stack.
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

const EMAIL = `trend-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'TrendLive123!',
    passwordConfirmation: 'TrendLive123!',
    displayName: 'Trend Live',
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
    headers: { cookie, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })

try {
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Vauxhall',
          model: 'Insignia',
          registrationNumber: `TR ${Math.floor(Math.random() * 9000 + 1000)}`,
          distanceUnit: 'KILOMETERS',
        }),
      })
    ).json()
  ).data
  const fuelUrl = `/vehicles/${vehicle.id}/fuel`
  const trendUrl = `/vehicles/${vehicle.id}/fuel/trend`

  console.log('\n[1] One fill measures nothing, and says so')
  await call(fuelUrl, {
    method: 'POST',
    body: JSON.stringify({
      filledOn: '2025-11-05',
      odometer: 20_000,
      quantity: 55,
      quantityUnit: 'LITRES',
      isFullTank: true,
      totalAmount: '80.00',
    }),
  })
  const one = (await (await call(trendUrl)).json()).data
  check(
    one.unavailableReason === 'NO_INTERVALS' && one.direction === null,
    'a single fill yields no trend and no verdict',
    `expected NO_INTERVALS, got ${one.unavailableReason}`,
  )

  console.log('\n[2] Eight months of fills, getting thirstier')
  // 1000 km a month. 55 L through April (5.5 L/100km), then 70 L (7.0 L/100km). The step
  // is placed on the window boundary deliberately: the engine compares the last three
  // months against the three before, so this makes the expected answer exactly
  // (7.0 - 5.5) / 5.5 = 27.27%, a figure that can be checked by hand. An earlier version
  // of this script stepped a month too soon, which put a 7.0 month inside the earlier
  // window and made the honest answer 16.67% look like a bug.
  const months = [
    '2025-12-05',
    '2026-01-05',
    '2026-02-05',
    '2026-03-05',
    '2026-04-05',
    '2026-05-05',
    '2026-06-05',
    '2026-07-05',
  ]
  let odo = 20_000
  for (const [i, date] of months.entries()) {
    odo += 1000
    const res = await call(fuelUrl, {
      method: 'POST',
      body: JSON.stringify({
        filledOn: date,
        odometer: odo,
        quantity: i < 5 ? 55 : 70,
        quantityUnit: 'LITRES',
        isFullTank: true,
        totalAmount: '95.00',
      }),
    })
    if (!res.ok) throw new Error(`fill ${date} failed: ${res.status} ${await res.text()}`)
  }
  const trend = (await (await call(trendUrl)).json()).data
  check(
    trend.points.length === 8,
    `8 monthly points returned`,
    `expected 8 points, got ${trend.points.length}`,
  )
  check(
    trend.points[0].period === '2025-12' && trend.points.at(-1).period === '2026-07',
    'months run 2025-12 to 2026-07, oldest first',
    `unexpected range: ${trend.points[0]?.period}..${trend.points.at(-1)?.period}`,
  )

  console.log('\n[3] The deterioration is detected, and quantified')
  check(
    trend.direction === 'WORSENING',
    `direction WORSENING`,
    `expected WORSENING, got ${trend.direction}`,
  )
  check(
    Math.abs(trend.changePercent - 27.27) < 0.5,
    `change ${trend.changePercent}% — matches 5.5 → 7.0 L/100km`,
    `expected ~27.27%, got ${trend.changePercent}`,
  )
  check(
    trend.points[0].litresPer100Km === 5.5 && trend.points.at(-1).litresPer100Km === 7,
    'monthly figures are right at both ends (5.5 and 7.0 L/100km)',
    `ends wrong: ${trend.points[0].litresPer100Km} / ${trend.points.at(-1).litresPer100Km}`,
  )

  console.log('\n[4] It names the windows it compared')
  check(
    trend.basis?.recent?.[0] === '2026-05' &&
      trend.basis?.recent?.[1] === '2026-07' &&
      trend.basis?.earlier?.[0] === '2026-02' &&
      trend.basis?.earlier?.[1] === '2026-04',
    `compared ${trend.basis?.recent?.join('–')} against ${trend.basis?.earlier?.join('–')}`,
    `wrong basis: ${JSON.stringify(trend.basis)}`,
  )

  console.log('\n[5] And admits the seasons could explain some of it')
  check(
    trend.cautions.includes('SEASONAL_OVERLAP'),
    'seasonal overlap flagged — under a year of history',
    `expected SEASONAL_OVERLAP, got ${JSON.stringify(trend.cautions)}`,
  )

  console.log('\n[6] A missed fill is excluded rather than silently averaged in')
  await call(fuelUrl, {
    method: 'POST',
    body: JSON.stringify({
      filledOn: '2026-08-05',
      odometer: 29_000,
      quantity: 60,
      quantityUnit: 'LITRES',
      isFullTank: true,
      missedFill: true,
      totalAmount: '88.00',
    }),
  })
  const after = (await (await call(trendUrl)).json()).data
  check(
    !after.points.some((p) => p.period === '2026-08'),
    'the unusable interval produced no August point',
    'a missed fill leaked into the trend',
  )

  console.log('\n[7] Tenant isolation holds on the new route')
  const strangerEmail = `trend-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'TrendLive123!',
      passwordConfirmation: 'TrendLive123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const stolen = await fetch(`${API}/workspaces/${ws}${trendUrl}`, { headers: { cookie: sCookie } })
  check(stolen.status === 404, '404 for a non-member', `expected 404, got ${stolen.status}`)
  sql(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(
    `DELETE FROM workspace_members WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(
    `DELETE FROM workspaces WHERE owner_user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(
    `DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(
    `DELETE FROM email_verification_tokens WHERE user_id IN (SELECT id FROM users WHERE email='${strangerEmail}');`,
  )
  sql(`DELETE FROM users WHERE email='${strangerEmail}';`)

  console.log('\n[8] The average and the trend agree with each other')
  const economy = (await (await call(`/vehicles/${vehicle.id}/fuel/economy`)).json()).data
  const measured = after.points.reduce((s, p) => s + p.intervalCount, 0)
  check(
    measured === economy.intervals.length,
    `${measured} intervals in the trend, ${economy.intervals.length} in the average — one definition, not two`,
    `trend has ${measured} intervals, economy has ${economy.intervals.length}`,
  )
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of ['expenses', 'odometer_entries', 'fuel_entries', 'reminders', 'audit_logs']) {
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
  errs.length ? `\nFUEL TREND VERIFICATION FAILED (${errs.length})\n` : '\nFUEL TREND VERIFIED\n',
)
