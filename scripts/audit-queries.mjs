/**
 * HARD-004 — counts the SQL statements each endpoint actually issues.
 *
 * N+1 is not a code smell you can reliably read: an `include` that looks innocent and a
 * loop that looks expensive often behave the other way round. This drives the RUNNING
 * stack and counts what Postgres was asked to do, grouped by statement shape, so a repeat
 * count of 78 is a measurement rather than a suspicion.
 *
 * Requires `log_min_duration_statement = 0` on the database:
 *   ALTER SYSTEM SET log_min_duration_statement = 0; SELECT pg_reload_conf();
 * `--reset` puts that back to -1 when the sweep is finished.
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
const psql = (q) =>
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

if (process.argv.includes('--reset')) {
  psql('ALTER SYSTEM SET log_min_duration_statement = -1;')
  psql('SELECT pg_reload_conf();')
  console.log('Statement logging disabled.')
  process.exit(0)
}

if (psql('SHOW log_min_duration_statement;') !== '0') {
  console.error('Statement logging is off. Run:')
  console.error('  docker exec -i autoservices-postgres psql -U autoservices -d autoservices \\')
  console.error(
    '    -c "ALTER SYSTEM SET log_min_duration_statement = 0;" -c \'SELECT pg_reload_conf();\'',
  )
  process.exit(1)
}

/**
 * Postgres logs to stderr, and `docker logs` passes the container's stderr through on its
 * own stderr — so reading only stdout returns nothing at all. The redirect is the whole
 * point of going through a shell here.
 */
const logs = () =>
  execFileSync('bash', ['-c', 'docker logs --tail 40000 autoservices-postgres 2>&1'], {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })

/**
 * Reduces a statement to its shape: literals, parameter lists and identifier lists all
 * collapse, so two reads of the same table with different ids count as one repeated shape
 * rather than two unrelated queries.
 */
function shapeOf(sql) {
  return sql
    .replace(/\$\d+/g, '?')
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/IN \((\?(, )?)+\)/gi, 'IN (?)')
    .trim()
    .slice(0, 150)
}

/** Statements logged after `mark`, in order. */
function statementsSince(mark) {
  const text = logs()
  const index = text.lastIndexOf(mark)
  if (index === -1) throw new Error('marker not found in the postgres log')
  const after = text.slice(index + mark.length)
  const out = []
  /**
   * Only `execute` and simple `statement` lines count. An extended-protocol query logs
   * parse, bind AND execute for the same SQL, so matching all three would report three
   * times as many queries as the database actually ran — an audit that inflates its own
   * numbers is worse than no audit.
   */
  const re = /duration: ([\d.]+) ms\s+(?:statement|execute [^:]*):\s+([\s\S]*?)(?=\n\d{4}-|\n?$)/g
  let m
  while ((m = re.exec(after)) !== null) {
    const sql = m[2].replace(/\n/g, ' ').trim()
    if (!sql || /^(BEGIN|COMMIT|ROLLBACK|SET |DEALLOCATE|DISCARD)/i.test(sql)) continue
    if (sql.includes('pg_reload_conf') || sql.includes('audit_marker')) continue
    out.push({ ms: Number(m[1]), sql })
  }
  return out
}

async function measure(label, run) {
  const mark = `audit_marker_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  psql(`SELECT '${mark}';`)
  await new Promise((r) => setTimeout(r, 250))
  const started = performance.now()
  const status = await run()
  const wall = performance.now() - started
  await new Promise((r) => setTimeout(r, 500))

  const statements = statementsSince(mark)
  const byShape = new Map()
  for (const s of statements) {
    const shape = shapeOf(s.sql)
    const row = byShape.get(shape) ?? { count: 0, ms: 0, sample: s.sql }
    row.count += 1
    row.ms += s.ms
    byShape.set(shape, row)
  }
  const repeated = [...byShape.entries()]
    .filter(([, v]) => v.count > 1)
    .sort((a, b) => b[1].count - a[1].count)
  const dbMs = statements.reduce((sum, s) => sum + s.ms, 0)

  return { label, status, wall, statements: statements.length, dbMs, repeated, byShape }
}

// ---------------------------------------------------------------------------

const EMAIL = process.env.AUDIT_EMAIL ?? 'andrei@autoservices.local'
const login = await fetch(`${API}/auth/dev-login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL }),
})
if (!login.ok) throw new Error(`dev-login failed: ${login.status}`)
const cookie = (login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie') ?? '').split(
  ';',
)[0]
const session = await (await fetch(`${API}/auth/session`, { headers: { cookie } })).json()
const ws = session.data.workspaces[0].id
const get = (p) =>
  fetch(`${API}/workspaces/${ws}${p}`, { headers: { cookie } }).then((r) => r.status)

const vehicles = (
  await (await fetch(`${API}/workspaces/${ws}/vehicles`, { headers: { cookie } })).json()
).data
const v = vehicles[0]?.id
const year = new Date().getUTCFullYear()

const ENDPOINTS = [
  ['GET /vehicles', () => get('/vehicles')],
  ['GET /vehicles/:id', () => get(`/vehicles/${v}`)],
  ['GET /vehicles/:id/timeline', () => get(`/vehicles/${v}/timeline`)],
  ['GET /vehicles/:id/services', () => get(`/vehicles/${v}/services`)],
  ['GET /vehicles/:id/maintenance', () => get(`/vehicles/${v}/maintenance`)],
  ['GET /vehicles/:id/fuel', () => get(`/vehicles/${v}/fuel`)],
  ['GET /vehicles/:id/fuel/economy', () => get(`/vehicles/${v}/fuel/economy`)],
  ['GET /vehicles/:id/fuel/trend', () => get(`/vehicles/${v}/fuel/trend`)],
  ['GET /vehicles/:id/odometer', () => get(`/vehicles/${v}/odometer`)],
  ['GET /inspections', () => get('/inspections')],
  ['GET /insurance-policies', () => get('/insurance-policies')],
  ['GET /road-tax', () => get('/road-tax')],
  ['GET /expenses', () => get('/expenses')],
  ['GET /expenses/summary', () => get('/expenses/summary')],
  ['GET /documents', () => get('/documents')],
  ['GET /reminders', () => get('/reminders')],
  ['GET /members', () => get('/members')],
  ['GET /services', () => get('/services')],
  ['GET /maintenance/due', () => get('/maintenance/due')],
  [`GET /reports/costs`, () => get(`/reports/costs?from=${year}-01-01&to=${year}-12-31`)],
  [`GET /reports/fleet`, () => get(`/reports/fleet?from=${year}-01-01&to=${year}-12-31`)],
  ['GET /dashboard', () => get('/dashboard')],
]

console.log(`\nQuery audit — workspace ${ws}, ${vehicles.length} vehicles\n`)
console.log('  queries   db ms   wall ms  status  endpoint')
console.log('  ' + '-'.repeat(74))

const results = []
for (const [label, run] of ENDPOINTS) {
  try {
    const r = await measure(label, run)
    results.push(r)
    const flag = r.statements > 12 ? ' ⚠' : ''
    console.log(
      `  ${String(r.statements).padStart(7)}  ${r.dbMs.toFixed(1).padStart(6)}  ` +
        `${r.wall.toFixed(0).padStart(7)}  ${String(r.status).padStart(6)}  ${label}${flag}`,
    )
  } catch (err) {
    console.log(
      `  ${'—'.padStart(7)}  ${'—'.padStart(6)}  ${'—'.padStart(7)}  ${'ERR'.padStart(6)}  ${label}: ${err.message}`,
    )
  }
}

const detail = process.argv.find((a) => a.startsWith('--detail='))
if (detail) {
  const needle = detail.slice('--detail='.length).toLowerCase()
  const target = results.find((r) => r.label.toLowerCase().includes(needle))
  if (!target) {
    console.error(`\nNo endpoint matching "${needle}".`)
  } else {
    console.log(`\nEvery statement issued by ${target.label}:\n`)
    let n = 0
    for (const [shape, v] of target.byShape.entries()) {
      n += 1
      console.log(`  ${String(n).padStart(2)}. ×${v.count}  ${v.ms.toFixed(2)} ms`)
      console.log(`      ${shape.slice(0, 160)}`)
    }
  }
}

console.log('\nRepeated statement shapes (the N+1 signal):\n')
let anyRepeat = false
for (const r of results) {
  const serious = r.repeated.filter(([, v]) => v.count >= 3)
  if (serious.length === 0) continue
  anyRepeat = true
  console.log(`  ${r.label}`)
  for (const [shape, v] of serious.slice(0, 4)) {
    console.log(
      `    ×${String(v.count).padStart(3)}  ${v.ms.toFixed(1).padStart(6)} ms  ${shape.slice(0, 96)}`,
    )
  }
}
if (!anyRepeat) console.log('  None: no statement shape repeats 3+ times in a single request.')

const worst = [...results].sort((a, b) => b.dbMs - a.dbMs).slice(0, 5)
console.log('\nSlowest by database time:\n')
for (const r of worst) {
  console.log(
    `  ${r.dbMs.toFixed(1).padStart(7)} ms  ${String(r.statements).padStart(3)} queries  ${r.label}`,
  )
}
console.log()
