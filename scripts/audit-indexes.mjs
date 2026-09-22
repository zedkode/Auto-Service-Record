/**
 * HARD-005 — index review against real query plans.
 *
 * `audit-plans.mjs` proves the queries this application issues are served by indexes.
 * This asks the other three questions an index review has to answer:
 *
 *   1. Which indexes does real traffic actually use? An index nothing reads still costs
 *      every INSERT, UPDATE and DELETE on its table, plus its share of the write-ahead
 *      log and every VACUUM.
 *   2. Which are redundant? An index whose columns are a leading prefix of another's is
 *      paid for twice and read once.
 *   3. Which foreign keys have no index? Postgres does not create one, and without it
 *      every delete of a parent row scans the child table.
 *
 * The usage figures are evidence about THIS application's endpoints, not proof an index is
 * dead: a rarely-exercised admin path or a constraint's own lookup will not show up in one
 * sweep. So this reports candidates with the reason to look, and never a verdict.
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
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      q,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim()

const rows = (q) =>
  psql(q)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('|'))

// ---------------------------------------------------------------------------
// 1. Redundant indexes — purely structural, true regardless of traffic.
// ---------------------------------------------------------------------------

function redundantIndexes() {
  const all = rows(`
    SELECT t.relname, i.relname, array_to_string(
             ARRAY(SELECT pg_get_indexdef(i.oid, k + 1, true)
                   FROM generate_subscripts(ix.indkey, 1) AS k
                   ORDER BY k), ','),
           ix.indisunique::text, (ix.indpred IS NOT NULL)::text AS partial
      FROM pg_index ix
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
     ORDER BY t.relname, i.relname;`)

  const byTable = new Map()
  for (const [table, index, cols, unique, partial] of all) {
    const list = byTable.get(table) ?? []
    /**
     * `::text` on a boolean yields 'true'/'false'. psql's 't'/'f' is only its DISPLAY
     * form, and comparing against it here silently made every primary key look redundant
     * against its own composite unique — the second time that trap has bitten in this
     * repository, so it is written down rather than just fixed.
     */
    list.push({
      index,
      cols: cols.split(','),
      unique: unique === 'true',
      partial: partial === 'true',
    })
    byTable.set(table, list)
  }

  const findings = []
  for (const [table, indexes] of byTable) {
    for (const a of indexes) {
      for (const b of indexes) {
        if (a.index === b.index) continue
        // A partial index covers a different row set, so it is never redundant against a
        // full one however its columns line up.
        if (a.partial || b.partial) continue
        if (a.cols.length >= b.cols.length) continue
        const isPrefix = a.cols.every((c, i) => c === b.cols[i])
        if (!isPrefix) continue
        // A unique index enforces a constraint, so it stays whatever else exists.
        if (a.unique) continue
        findings.push({ table, redundant: a.index, coveredBy: b.index, cols: a.cols.join(', ') })
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 2. Foreign keys with no index on the referencing side.
// ---------------------------------------------------------------------------

function unindexedForeignKeys() {
  return rows(`
    SELECT c.conrelid::regclass::text, c.conname,
           array_to_string(ARRAY(
             SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum
             ORDER BY u.ord), ',')
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_index ix
          WHERE ix.indrelid = c.conrelid
            AND ix.indpred IS NULL
            -- The FK columns must be a LEADING prefix of the index to be usable for it.
            AND (ix.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
            AND array_length(c.conkey, 1) <= ix.indnatts
            AND (SELECT array_agg(k ORDER BY ord)
                   FROM unnest(ix.indkey::int2[]) WITH ORDINALITY AS t(k, ord)
                  WHERE ord <= array_length(c.conkey, 1)) @> c.conkey
       )
     ORDER BY 1, 2;`)
}

// ---------------------------------------------------------------------------
// 3. Which indexes this application's own endpoints actually read.
// ---------------------------------------------------------------------------

async function driveEveryEndpoint() {
  const login = await fetch(`${API}/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'andrei@autoservices.local' }),
  })
  if (!login.ok) throw new Error(`dev-login failed: ${login.status}`)
  const cookie = (login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  const session = await (await fetch(`${API}/auth/session`, { headers: { cookie } })).json()
  const ws = session.data.workspaces[0].id
  const get = (p) => fetch(`${API}/workspaces/${ws}${p}`, { headers: { cookie } })

  const vehicles = (await (await get('/vehicles')).json()).data
  const v = vehicles[0]?.id
  const year = new Date().getUTCFullYear()
  const range = `from=${year}-01-01&to=${year}-12-31`

  const paths = [
    '/vehicles',
    '/vehicles?includeInactive=true',
    '/vehicles/deleted',
    `/vehicles/${v}`,
    `/vehicles/${v}/timeline`,
    `/vehicles/${v}/services`,
    `/vehicles/${v}/maintenance`,
    `/vehicles/${v}/fuel`,
    `/vehicles/${v}/fuel/economy`,
    `/vehicles/${v}/fuel/trend`,
    `/vehicles/${v}/odometer`,
    `/vehicles/${v}/odometer/current`,
    `/vehicles/${v}/warranties`,
    '/inspections',
    '/insurance-policies',
    '/road-tax',
    '/warranties',
    '/expenses',
    '/expenses/summary',
    '/documents',
    '/reminders',
    '/members',
    '/services',
    '/maintenance/due',
    '/exports',
    '/dashboard',
    `/reports/costs?${range}`,
    `/reports/fleet?${range}`,
  ]

  let ok = 0
  for (const p of paths) {
    const res = await get(p)
    if (res.ok) ok += 1
  }
  return { attempted: paths.length, ok }
}

function indexUsage() {
  return rows(`
    SELECT relname, indexrelname, idx_scan::text,
           pg_size_pretty(pg_relation_size(indexrelid)),
           (SELECT n_live_tup::text FROM pg_stat_user_tables u WHERE u.relid = s.relid)
      FROM pg_stat_user_indexes s
     WHERE schemaname = 'public'
     ORDER BY idx_scan ASC, relname;`)
}

// ---------------------------------------------------------------------------

console.log('\nIndex review\n' + '='.repeat(72))

const total = psql(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'public';`)
const size = psql(`
  SELECT pg_size_pretty(sum(pg_relation_size(indexrelid)))
    FROM pg_stat_user_indexes WHERE schemaname = 'public';`)
console.log(`\n${total} indexes, ${size} total.`)

console.log('\n--- Redundant: a leading prefix of another index on the same table ---\n')
const redundant = redundantIndexes()
if (redundant.length === 0) {
  console.log('  None.')
} else {
  for (const r of redundant) {
    console.log(`  ${r.table}`)
    console.log(`    ${r.redundant}  (${r.cols})`)
    console.log(`    covered by ${r.coveredBy}`)
  }
}

console.log('\n--- Foreign keys with no usable index on the referencing columns ---\n')
const fks = unindexedForeignKeys()
if (fks.length === 0) {
  console.log('  None: every foreign key can be checked by an index.')
} else {
  for (const [table, name, cols] of fks) console.log(`  ${table.padEnd(28)} ${cols}  (${name})`)
}

console.log('\n--- Usage: which indexes this application’s endpoints actually read ---\n')
psql(`SELECT pg_stat_reset();`)
const driven = await driveEveryEndpoint()
console.log(`  drove ${driven.ok}/${driven.attempted} endpoints\n`)

const usage = indexUsage()
const unused = usage.filter(([, , scans]) => scans === '0')
const used = usage.filter(([, , scans]) => scans !== '0')
console.log(`  ${used.length} indexes were read, ${unused.length} were not.\n`)
console.log('  Read most often:')
for (const [table, index, scans] of [...used]
  .sort((a, b) => Number(b[2]) - Number(a[2]))
  .slice(0, 8)) {
  console.log(`    ${String(scans).padStart(5)} scans  ${table}.${index}`)
}

/**
 * Only indexes on tables with rows are worth listing: an index on an empty table cannot be
 * scanned, so its absence from the usage figures says nothing at all.
 */
const meaningful = unused.filter(([, , , , live]) => Number(live ?? 0) > 0)
console.log(`\n  Not read by any endpoint, on tables that HAVE rows (${meaningful.length}):`)
for (const [table, index, , sz, live] of meaningful) {
  console.log(`    ${table}.${index}  (${sz}, ${live} rows)`)
}
console.log(
  '\n  These are candidates to LOOK at, not to drop: one sweep of the customer API does\n' +
    '  not exercise admin paths, constraint lookups, or anything seasonal.\n',
)
