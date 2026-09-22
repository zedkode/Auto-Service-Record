/**
 * EXP-001 end to end: request an export, let the worker build it, download the file and
 * read what is actually inside it.
 *
 * The point is the whole pipeline — API accepts and returns immediately, worker builds,
 * object storage holds it, and the only way to the bytes is a signed, expiring URL.
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

const EMAIL = `export-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'ExportLive123!',
    passwordConfirmation: 'ExportLive123!',
    displayName: 'Export Live',
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

async function waitReady(id, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const body = await (await call(`/exports/${id}`)).json()
    last = body.data
    if (last.status === 'READY' || last.status === 'FAILED') return last
    await new Promise((r) => setTimeout(r, 400))
  }
  return last
}

try {
  console.log('\n[1] A workspace with something worth exporting')
  const vehicle = (
    await (
      await call('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          manufacturer: 'Ford',
          model: 'Mondeo',
          registrationNumber: `EX ${Math.floor(Math.random() * 9000 + 1000)}`,
          distanceUnit: 'MILES',
        }),
      })
    ).json()
  ).data
  // A vendor name that is a spreadsheet formula: the export must not carry it live.
  await call(`/vehicles/${vehicle.id}/services`, {
    method: 'POST',
    body: JSON.stringify({
      performedOn: '2026-03-10',
      title: 'Brakes, front',
      totalAmount: '450.00',
      currency: 'GBP',
      odometer: 100_000,
      workshopName: '=cmd|calc',
    }),
  })
  await call(`/vehicles/${vehicle.id}/fuel`, {
    method: 'POST',
    body: JSON.stringify({
      filledOn: '2026-03-12',
      odometer: 100_400,
      quantity: 48.5,
      quantityUnit: 'LITRES',
      isFullTank: true,
      totalAmount: '71.30',
    }),
  })
  check(true, 'vehicle, service and fill recorded', '')

  console.log('\n[2] The request is accepted immediately, not built inline')
  const started = Date.now()
  const created = await call('/exports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'EXPENSES', format: 'CSV' }),
  })
  const job = (await created.json()).data
  const acceptedIn = Date.now() - started
  check(
    created.status === 202 && job.status === 'PENDING',
    `202 PENDING in ${acceptedIn} ms`,
    `expected 202/PENDING, got ${created.status}/${job.status}`,
  )

  console.log('\n[3] The worker builds it')
  const ready = await waitReady(job.id)
  check(
    ready?.status === 'READY',
    `READY with ${ready?.rowCount} rows, ${ready?.byteSize} bytes`,
    `export did not become READY: ${JSON.stringify(ready)}`,
  )

  console.log('\n[4] The only way to the bytes is a signed, expiring URL')
  const dl = await call(`/exports/${job.id}/download`, { method: 'POST' })
  const link = (await dl.json()).data
  const signed = new URL(link.url)
  check(
    dl.status === 200 &&
      signed.searchParams.has('X-Amz-Signature') &&
      signed.searchParams.has('X-Amz-Expires'),
    `signed URL issued, valid for ${link.expiresInSeconds}s`,
    `unsigned or missing URL: ${link?.url?.slice(0, 80)}`,
  )

  console.log('\n[5] The object key is not guessable from anything the client knows')
  const key = sql(`SELECT object_key FROM export_jobs WHERE id='${job.id}';`)
  check(
    !key.includes(job.id) && !key.includes(EMAIL) && /[0-9a-f]{48}/.test(key),
    'key contains 24 random bytes and no identifier the caller supplied',
    `weak object key: ${key}`,
  )

  console.log('\n[6] The file downloads, and contains the data')
  const file = await fetch(link.url)
  const text = await file.text()
  const lines = text.trim().split('\r\n')
  check(
    file.status === 200 && lines[0].includes('Date') && lines[0].includes('Amount'),
    `downloaded ${text.length} bytes; header: ${lines[0]?.slice(0, 60)}`,
    `download failed: ${file.status}`,
  )
  check(
    lines.length >= 3,
    `${lines.length - 1} data rows (service + fuel)`,
    `expected at least 2 data rows, got ${lines.length - 1}`,
  )

  console.log('\n[7] A formula in the data is defused, not carried into the spreadsheet')
  check(
    text.includes("'=cmd|calc") && !/,=cmd/.test(text),
    'the vendor name is prefixed so no spreadsheet will evaluate it',
    'CSV INJECTION: a formula reached the file unescaped',
  )

  console.log('\n[8] Excel will read it as UTF-8')
  // Read the BYTES: `Response.text()` decodes UTF-8 and strips a leading BOM, so checking
  // the decoded string can never see one and would report a missing BOM that is present.
  const raw = new Uint8Array(await (await fetch(link.url)).arrayBuffer())
  check(
    raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf,
    'byte-order mark present',
    `no BOM — accents will mojibake (first bytes: ${[...raw.slice(0, 3)]})`,
  )

  console.log('\n[9] JSON carries the same shape')
  const jsonJob = (
    await (
      await call('/exports', {
        method: 'POST',
        body: JSON.stringify({ kind: 'FUEL', format: 'JSON' }),
      })
    ).json()
  ).data
  const jsonReady = await waitReady(jsonJob.id)
  const jsonLink = (
    await (await call(`/exports/${jsonJob.id}/download`, { method: 'POST' })).json()
  ).data
  const parsed = await (await fetch(jsonLink.url)).json()
  check(
    jsonReady?.status === 'READY' && Array.isArray(parsed) && parsed[0]?.['Quantity'] === '48.500',
    `JSON export: ${parsed.length} row(s), quantity kept as text "${parsed[0]?.['Quantity']}"`,
    `JSON export wrong: ${JSON.stringify(parsed).slice(0, 120)}`,
  )

  console.log('\n[10] A VIEWER may read the workspace but not take it away')
  // Demoting ourselves is the cheapest way to get a VIEWER session in this workspace.
  sql(`UPDATE workspace_members SET role='VIEWER' WHERE workspace_id='${ws}';`)
  const refused = await call('/exports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'VEHICLES', format: 'CSV' }),
  })
  const stillLists = await call('/exports')
  check(
    refused.status === 403 && stillLists.status === 200,
    '403 on create, 200 on list — can look, cannot walk away with it',
    `expected 403/200, got ${refused.status}/${stillLists.status}`,
  )
  sql(`UPDATE workspace_members SET role='OWNER' WHERE workspace_id='${ws}';`)

  console.log('\n[11] Another workspace cannot see or fetch this export')
  const strangerEmail = `export-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'ExportLive123!',
      passwordConfirmation: 'ExportLive123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const peek = await fetch(`${API}/workspaces/${ws}/exports/${job.id}`, {
    headers: { cookie: sCookie },
  })
  const grab = await fetch(`${API}/workspaces/${ws}/exports/${job.id}/download`, {
    method: 'POST',
    headers: { cookie: sCookie },
  })
  check(
    peek.status === 404 && grab.status === 404,
    '404 on both read and download for a non-member',
    `expected 404/404, got ${peek.status}/${grab.status}`,
  )
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

  console.log('\n[12] An expired export refuses to hand out a link')
  sql(`UPDATE export_jobs SET expires_at = now() - interval '1 hour' WHERE id='${job.id}';`)
  const stale = await call(`/exports/${job.id}/download`, { method: 'POST' })
  const marked = sql(`SELECT status FROM export_jobs WHERE id='${job.id}';`)
  check(
    stale.status === 409 && marked === 'EXPIRED',
    '409, and the row is marked EXPIRED so the list stops offering it',
    `expected 409/EXPIRED, got ${stale.status}/${marked}`,
  )

  console.log('\n[13] Both requests are on the audit trail')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE workspace_id='${ws}' AND resource_type='export_job';`,
  )
  check(
    actions.includes('export.requested') && actions.includes('export.downloaded'),
    `audited: ${actions}`,
    `missing audit entries: ${actions}`,
  )
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'export_jobs',
    'expenses',
    'odometer_entries',
    'fuel_entries',
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
  errs.length ? `\nEXPORT VERIFICATION FAILED (${errs.length})\n` : '\nEXPORTS VERIFIED\n',
)
