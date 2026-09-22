/**
 * HARD-004/005 — query plans at a volume where the plan matters.
 *
 * At two vehicles Postgres sequential-scans everything and is right to: the whole table
 * is one page. A plan only becomes evidence at a size where an index can win, so this
 * builds a throwaway workspace with a realistic multi-year fleet, runs EXPLAIN ANALYZE on
 * the query shapes the API actually issues, and reports what the planner chose.
 *
 * The data is removed afterwards, always — including when a query throws.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const VEHICLES = Number(process.env.BENCH_VEHICLES ?? 40)
const MONTHS = Number(process.env.BENCH_MONTHS ?? 48)

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
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      q,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim()

const SLUG = `bench-${Date.now().toString(36)}`
let ws = null

function seed() {
  ws = psql(`
    WITH u AS (
      INSERT INTO users (email, password_hash, status, email_verified_at, created_at, updated_at)
      VALUES ('${SLUG}@example.com', 'x', 'ACTIVE', now(), now(), now())
      RETURNING id
    ), w AS (
      INSERT INTO workspaces (name, slug, type, owner_user_id, created_at, updated_at)
      SELECT 'Bench', '${SLUG}', 'BUSINESS', u.id, now(), now() FROM u
      RETURNING id
    )
    SELECT id FROM w;`)

  psql(`
    INSERT INTO vehicles (workspace_id, manufacturer, model, registration_number, status,
                          distance_unit, current_odometer, current_odometer_unit, created_at, updated_at)
    SELECT '${ws}', 'Bench', 'Van ' || g, 'BN' || lpad(g::text, 5, '0'), 'ACTIVE',
           'MILES', 20000 + g * 1000, 'MILES', now(), now()
    FROM generate_series(1, ${VEHICLES}) g;`)

  // Two odometer readings a month per vehicle, monotonically increasing.
  psql(`
    INSERT INTO odometer_entries (workspace_id, vehicle_id, value, unit, recorded_on, source,
                                  is_correction, created_at)
    SELECT '${ws}', v.id,
           10000 + (m * 900) + (s * 400),
           'MILES',
           (current_date - (m * 30))::date,
           'MANUAL', false, now()
    FROM vehicles v
    CROSS JOIN generate_series(0, ${MONTHS}) m
    CROSS JOIN generate_series(0, 1) s
    WHERE v.workspace_id = '${ws}';`)

  psql(`
    INSERT INTO expenses (workspace_id, vehicle_id, incurred_on, amount, currency, description,
                          source_type, created_at, updated_at)
    SELECT '${ws}', v.id, (current_date - (m * 30))::date,
           40 + (m % 17) * 9, 'GBP', 'Bench expense', 'MANUAL', now(), now()
    FROM vehicles v
    CROSS JOIN generate_series(0, ${MONTHS}) m
    WHERE v.workspace_id = '${ws}';`)

  psql(`
    INSERT INTO fuel_entries (workspace_id, vehicle_id, filled_on, odometer, odometer_unit,
                              quantity, quantity_unit, total_amount, currency, is_full_tank,
                              is_partial_fill, missed_fill, created_at, updated_at)
    SELECT '${ws}', v.id, (current_date - (d * 6))::date,
           10000 + d * 430, 'MILES', 44.5, 'LITRES', 63.20, 'GBP', true, false, false, now(), now()
    FROM vehicles v
    CROSS JOIN generate_series(0, ${MONTHS * 5}) d
    WHERE v.workspace_id = '${ws}';`)

  psql(`
    INSERT INTO service_records (workspace_id, vehicle_id, performed_on, title, total_amount,
                                 currency, created_at, updated_at)
    SELECT '${ws}', v.id, (current_date - (m * 90))::date, 'Bench service', 320.00, 'GBP', now(), now()
    FROM vehicles v
    CROSS JOIN generate_series(0, ${Math.floor(MONTHS / 3)}) m
    WHERE v.workspace_id = '${ws}';`)

  psql(`
    INSERT INTO vehicle_inspections (workspace_id, vehicle_id, inspection_type, result,
                                     performed_on, expires_on, created_at, updated_at)
    SELECT '${ws}', v.id, 'MOT', 'PASS',
           (current_date - (y * 365))::date, (current_date - (y * 365) + 365)::date, now(), now()
    FROM vehicles v
    CROSS JOIN generate_series(0, ${Math.floor(MONTHS / 12)}) y
    WHERE v.workspace_id = '${ws}';`)

  psql('ANALYZE;')
}

function cleanup() {
  if (!ws) return
  for (const t of [
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'service_records',
    'vehicle_inspections',
    'insurance_policies',
    'road_tax_records',
    'reminders',
    'audit_logs',
  ]) {
    psql(`DELETE FROM ${t} WHERE workspace_id = '${ws}';`)
  }
  psql(`DELETE FROM vehicles WHERE workspace_id = '${ws}';`)
  psql(`DELETE FROM workspace_members WHERE workspace_id = '${ws}';`)
  psql(`DELETE FROM workspaces WHERE id = '${ws}';`)
  psql(`DELETE FROM users WHERE email = '${SLUG}@example.com';`)
}

const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
const to = new Date().toISOString().slice(0, 10)

function explain(label, sql) {
  const plan = psql(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
  const parsed = JSON.parse(plan)[0]
  const ms = parsed['Execution Time']
  /**
   * Walk the plan tree rather than pattern-matching its JSON. The regex this replaces
   * required an exact key order and the literal words "Seq Scan", so it silently missed a
   * "Parallel Seq Scan" and anything nested in a subplan or InitPlan — a full scan taking
   * 2.27 ms was reported as no scan at all. A detector that can miss what it looks for is
   * worse than no detector, because it is quoted as evidence.
   */
  const seqScans = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node['Node Type'] === 'string' && node['Node Type'].includes('Seq Scan')) {
      seqScans.push(node['Relation Name'] ?? '?')
    }
    for (const key of ['Plans', 'Plan']) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach(walk)
      else if (child) walk(child)
    }
  }
  walk(parsed.Plan)
  return { label, ms, seqScans, rows: parsed.Plan['Actual Rows'] }
}

try {
  process.stdout.write(`Seeding ${VEHICLES} vehicles x ${MONTHS} months… `)
  seed()
  const counts = psql(`
    SELECT (SELECT count(*) FROM vehicles WHERE workspace_id='${ws}') || ' vehicles, ' ||
           (SELECT count(*) FROM expenses WHERE workspace_id='${ws}') || ' expenses, ' ||
           (SELECT count(*) FROM odometer_entries WHERE workspace_id='${ws}') || ' readings, ' ||
           (SELECT count(*) FROM fuel_entries WHERE workspace_id='${ws}') || ' fills';`)
  console.log(counts)

  const QUERIES = [
    [
      'cost report — expenses in range',
      `SELECT e.amount, e.currency, e.incurred_on, e.vehicle_id
         FROM expenses e LEFT JOIN vehicles j0 ON (j0.id, j0.workspace_id) = (e.vehicle_id, e.workspace_id)
        WHERE e.deleted_at IS NULL AND e.incurred_on >= '${from}' AND e.incurred_on <= '${to}'
          AND (e.vehicle_id IS NULL OR j0.deleted_at IS NULL) AND e.workspace_id = '${ws}'`,
    ],
    [
      'cost report — odometer in range',
      `SELECT o.vehicle_id, o.recorded_on, o.value, o.unit
         FROM odometer_entries o JOIN vehicles v ON v.id = o.vehicle_id
        WHERE o.recorded_on >= '${from}' AND o.recorded_on <= '${to}'
          AND o.is_correction = false AND v.deleted_at IS NULL AND o.workspace_id = '${ws}'`,
    ],
    [
      'fleet — latest MOT per vehicle',
      `SELECT i.vehicle_id, i.expires_on FROM vehicle_inspections i
         JOIN vehicles v ON v.id = i.vehicle_id
        WHERE i.expires_on IS NOT NULL AND v.deleted_at IS NULL AND i.workspace_id = '${ws}'`,
    ],
    [
      'fuel economy — one vehicle by odometer',
      `SELECT f.* FROM fuel_entries f
        WHERE f.vehicle_id = (SELECT id FROM vehicles WHERE workspace_id='${ws}' LIMIT 1)
          AND f.deleted_at IS NULL AND f.workspace_id = '${ws}'
        ORDER BY f.odometer ASC`,
    ],
    [
      'vehicle list',
      `SELECT * FROM vehicles WHERE workspace_id = '${ws}' AND deleted_at IS NULL
          AND status NOT IN ('SOLD','SCRAPPED','ARCHIVED') ORDER BY created_at DESC`,
    ],
    [
      'timeline — services for one vehicle',
      `SELECT * FROM service_records
        WHERE vehicle_id = (SELECT id FROM vehicles WHERE workspace_id='${ws}' LIMIT 1)
          AND deleted_at IS NULL AND workspace_id = '${ws}'
        ORDER BY performed_on DESC LIMIT 25`,
    ],
    [
      'dashboard — recent odometer across the fleet',
      `SELECT * FROM odometer_entries WHERE workspace_id = '${ws}'
        ORDER BY recorded_on DESC, created_at DESC LIMIT 8`,
    ],
    [
      'dashboard — recent services across the fleet',
      `SELECT * FROM service_records WHERE workspace_id = '${ws}' AND deleted_at IS NULL
        ORDER BY performed_on DESC, created_at DESC LIMIT 8`,
    ],
    [
      'dashboard — recent inspections across the fleet',
      `SELECT * FROM vehicle_inspections WHERE workspace_id = '${ws}' AND deleted_at IS NULL
        ORDER BY performed_on DESC, created_at DESC LIMIT 8`,
    ],
    [
      'FK check — children of one user (what a user delete does)',
      `SELECT 1 FROM expenses WHERE created_by_user_id =
         (SELECT owner_user_id FROM workspaces WHERE id = '${ws}') LIMIT 1`,
    ],
    [
      'expenses list — newest first',
      `SELECT * FROM expenses WHERE workspace_id = '${ws}' AND deleted_at IS NULL
        ORDER BY incurred_on DESC LIMIT 50`,
    ],
  ]

  console.log('\n     ms     rows  seq scans                         query')
  console.log('  ' + '-'.repeat(84))
  const findings = []
  for (const [label, sql] of QUERIES) {
    const r = explain(label, sql)
    const scans = r.seqScans.length ? r.seqScans.join(', ') : '—'
    if (r.seqScans.length) findings.push(r)
    console.log(
      `  ${r.ms.toFixed(2).padStart(7)}  ${String(r.rows).padStart(6)}  ${scans.padEnd(32)}  ${label}`,
    )
  }

  /**
   * A sequential scan of a small table is the planner being RIGHT: the whole table is a
   * page or two, and an index lookup would cost more than reading it. Listing those as
   * findings trains the reader to ignore the section. Only scans of tables big enough for
   * an index to win are worth a human's attention — verified separately by growing
   * `vehicles` to 60k rows, at which point the planner switches to the index by itself.
   */
  const SCAN_MATTERS_ABOVE = 5_000
  console.log(`\nSequential scans on tables above ${SCAN_MATTERS_ABOVE.toLocaleString()} rows:\n`)
  const sized = findings.flatMap((f) =>
    [...new Set(f.seqScans)].map((t) => ({
      label: f.label,
      table: t,
      rows: Number(psql(`SELECT count(*) FROM ${t};`)),
      ms: f.ms,
    })),
  )
  const serious = sized.filter((r) => r.rows >= SCAN_MATTERS_ABOVE)
  if (serious.length === 0) {
    console.log('  None — every scan was of a table small enough that scanning is correct.')
  } else {
    for (const r of serious) {
      console.log(
        `  ${r.label}: ${r.table} (${r.rows.toLocaleString()} rows) — ${r.ms.toFixed(2)} ms`,
      )
    }
  }
  const small = sized.filter((r) => r.rows < SCAN_MATTERS_ABOVE)
  if (small.length > 0) {
    const tables = [...new Set(small.map((r) => `${r.table} (${r.rows})`))].join(', ')
    console.log(`\n  Scanned, but correctly so at their size: ${tables}`)
  }
  console.log()
} finally {
  cleanup()
  psql('ANALYZE;')
}
