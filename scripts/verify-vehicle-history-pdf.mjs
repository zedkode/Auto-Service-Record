/**
 * EXP-002 end to end: a vehicle's complete history as a document, for handing to a buyer.
 *
 * The checks that matter are not "a PDF was produced". They are: does it contain the
 * history, does it state plainly that it is an owner-entered record rather than a verified
 * one, and does it keep the private documents private.
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
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

const EMAIL = `pdf-live-${Date.now()}@example.com`
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    password: 'PdfLiveHistory123!',
    passwordConfirmation: 'PdfLiveHistory123!',
    displayName: 'PDF Live',
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
async function waitReady(id, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = (await (await call(`/exports/${id}`)).json()).data
    if (last.status === 'READY' || last.status === 'FAILED') return last
    await new Promise((r) => setTimeout(r, 400))
  }
  return last
}

try {
  console.log('\n[1] A car with a history worth proving')
  const vehicle = await must(
    'vehicle',
    await call('/vehicles', {
      method: 'POST',
      body: JSON.stringify({
        manufacturer: 'Ford',
        model: 'Mondeo',
        trim: 'Titanium X',
        modelYear: 2016,
        vin: 'WF0EXXGBWE1234567',
        registrationNumber: `PD ${Math.floor(Math.random() * 9000 + 1000)}`,
        distanceUnit: 'MILES',
        currentOdometer: 96_000,
      }),
    }),
  )
  await must(
    'service',
    await call(`/vehicles/${vehicle.id}/services`, {
      method: 'POST',
      body: JSON.stringify({
        performedOn: '2026-02-10',
        title: 'Cambelt and water pump',
        totalAmount: '780.00',
        currency: 'GBP',
        odometer: 92_000,
        workshopName: 'Fosse Garage',
        parts: [
          { name: 'Cambelt kit', brand: 'Gates', partNumber: 'K015623XS', unitPrice: '180.00' },
        ],
      }),
    }),
  )
  await must(
    'inspection',
    await call(`/vehicles/${vehicle.id}/inspections`, {
      method: 'POST',
      body: JSON.stringify({
        performedOn: '2026-01-15',
        expiresOn: '2027-01-14',
        centreName: 'Fosse MOT Centre',
        advisories: [{ severity: 'MINOR', text: 'Nearside front tyre worn close to limit' }],
      }),
    }),
  )
  await must(
    'odometer',
    await call(`/vehicles/${vehicle.id}/odometer`, {
      method: 'POST',
      body: JSON.stringify({ value: 96_500, unit: 'MILES', recordedOn: '2026-09-01' }),
    }),
  )
  check(true, 'vehicle, service with parts, MOT with an advisory, mileage', '')

  console.log('\n[2] Only a PDF, and only with a vehicle named')
  const wrongFormat = await call('/exports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'VEHICLE_HISTORY', format: 'CSV', vehicleId: vehicle.id }),
  })
  const noVehicle = await call('/exports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'VEHICLE_HISTORY', format: 'PDF' }),
  })
  const pdfOfTable = await call('/exports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'EXPENSES', format: 'PDF' }),
  })
  check(
    wrongFormat.status === 422 && noVehicle.status === 422 && pdfOfTable.status === 422,
    'a history as CSV, a history with no vehicle, and a PDF of a table are all refused',
    `expected 422×3, got ${wrongFormat.status}/${noVehicle.status}/${pdfOfTable.status}`,
  )

  console.log('\n[3] The document is built')
  const job = await must(
    'export',
    await call('/exports', {
      method: 'POST',
      body: JSON.stringify({ kind: 'VEHICLE_HISTORY', format: 'PDF', vehicleId: vehicle.id }),
    }),
  )
  const ready = await waitReady(job.id)
  check(
    ready?.status === 'READY' && ready.byteSize > 2000,
    `READY, ${ready?.byteSize} bytes, ${ready?.rowCount} events`,
    `not built: ${JSON.stringify(ready)}`,
  )

  console.log('\n[4] It is a real PDF, and it downloads')
  const link = await must('download', await call(`/exports/${job.id}/download`, { method: 'POST' }))
  const bytes = new Uint8Array(await (await fetch(link.url)).arrayBuffer())
  const head = new TextDecoder().decode(bytes.slice(0, 5))
  check(
    head === '%PDF-' && link.filename.endsWith('.pdf'),
    `${head} header, ${bytes.length} bytes, named ${link.filename}`,
    `not a PDF: header "${head}"`,
  )
  writeFileSync('/tmp/vehicle-history.pdf', bytes)

  console.log('\n[5] The history is actually in it')
  // pdftotext is the honest way to read it: it extracts what a person would see, so this
  // asserts on the rendered document rather than on the data that went in.
  const text = execFileSync(
    'bash',
    [
      '-c',
      'docker run --rm -i -v /tmp:/data minidocks/poppler pdftotext /data/vehicle-history.pdf - ' +
        '2>/dev/null || pdftotext /tmp/vehicle-history.pdf - 2>/dev/null || strings /tmp/vehicle-history.pdf',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const has = (s) => text.includes(s)
  check(
    has('Cambelt and water pump') && has('Fosse Garage'),
    'the service and its workshop appear',
    'the service is missing from the document',
  )
  check(
    has('Gates') || has('K015623XS'),
    'the parts fitted are listed',
    'parts are missing from the document',
  )
  check(
    has('Nearside front tyre worn close to limit'),
    'the MOT advisory is shown — a pass with advisories is not a clean pass',
    'ADVISORY OMITTED: the document would be flattering the car',
  )
  check(has('96,500') || has('96500'), 'the mileage log is present', 'mileage log missing')

  console.log('\n[6] It never claims to be more than it is')
  check(
    /not a certified|not an? verified|owner-entered/i.test(text) &&
      text.toLowerCase().includes('owner'),
    'states plainly that it is an owner-entered record, not a verified history',
    'NO DISCLAIMER: a buyer could read this as a certified history',
  )

  console.log('\n[7] Private documents stay private')
  const upload = await call('/documents/upload-session', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'secret-receipt.pdf',
      contentType: 'application/pdf',
      byteSize: 1024,
      vehicleId: vehicle.id,
      kind: 'RECEIPT',
      title: 'Cambelt receipt',
    }),
  })
  const objectKey = sql(
    `SELECT coalesce(max(storage_key), '') FROM documents WHERE workspace_id='${ws}';`,
  )
  check(
    upload.status < 500 && (objectKey === '' || !text.includes(objectKey)),
    'no storage key appears anywhere in the document',
    'OBJECT KEY LEAKED into the PDF',
  )
  check(
    !text.includes('X-Amz-Signature') && !text.includes('http://localhost:59000'),
    'no signed URL or storage endpoint in the document',
    'A STORAGE URL LEAKED into the PDF',
  )

  console.log('\n[8] Another workspace cannot fetch it')
  const strangerEmail = `pdf-x-${Date.now()}@example.com`
  const sReg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: strangerEmail,
      password: 'PdfLiveHistory123!',
      passwordConfirmation: 'PdfLiveHistory123!',
      displayName: 'Stranger',
      acceptTerms: true,
    }),
  })
  const sCookie = (sReg.headers.getSetCookie?.()[0] ?? '').split(';')[0]
  const grab = await fetch(`${API}/workspaces/${ws}/exports/${job.id}/download`, {
    method: 'POST',
    headers: { cookie: sCookie },
  })
  check(grab.status === 404, '404 for a non-member', `expected 404, got ${grab.status}`)
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
} finally {
  const uq = `(SELECT id FROM users WHERE email='${EMAIL}')`
  const wq = `(SELECT id FROM workspaces WHERE owner_user_id IN ${uq})`
  for (const t of [
    'export_jobs',
    'documents',
    'expenses',
    'odometer_entries',
    'fuel_entries',
    'inspection_advisories',
    'vehicle_inspections',
    'warranties',
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
  errs.length ? `\nPDF VERIFICATION FAILED (${errs.length})\n` : '\nVEHICLE HISTORY PDF VERIFIED\n',
)
