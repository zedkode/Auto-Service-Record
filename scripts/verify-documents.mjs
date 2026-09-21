/**
 * DOC-101…106 end to end against the RUNNING stack and real object storage.
 *
 * Asserts the security properties the brief names: private bucket, unguessable keys,
 * short-lived signed URLs, permission-checked downloads, and bytes verified rather than
 * trusted.
 */
import path from 'node:path'
import { createHash } from 'node:crypto'
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

const PDF = Buffer.from('%PDF-1.7\nverification document\n%%EOF\n')
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

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

async function signUp(label) {
  const email = `doc-live-${label}-${Date.now()}@example.com`
  const reg = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'DocumentLive123!',
      passwordConfirmation: 'DocumentLive123!',
      displayName: `Doc ${label}`,
      acceptTerms: true,
    }),
  })
  if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
  const cookie = (reg.headers.getSetCookie?.()[0] ?? reg.headers.get('set-cookie') ?? '').split(
    ';',
  )[0]
  const session = await (await fetch(`${API}/auth/session`, { headers: { cookie } })).json()
  return { email, cookie, ws: session.data.workspaces[0].id }
}

const call = (actor, p, init = {}) =>
  fetch(`${API}/workspaces/${actor.ws}${p}`, {
    ...init,
    headers: {
      cookie: actor.cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })

const owner = await signUp('owner')
const other = await signUp('other')
const emails = [owner.email, other.email]

try {
  const vehicle = (
    await (
      await call(owner, '/vehicles', {
        method: 'POST',
        body: JSON.stringify({ manufacturer: 'Ford', model: 'Mondeo', distanceUnit: 'MILES' }),
      })
    ).json()
  ).data

  console.log('\n[1] Upload session, direct PUT, finalise')
  const session = (
    await (
      await call(owner, '/documents/upload-session', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'mot-certificate.pdf',
          contentType: 'application/pdf',
          byteSize: PDF.byteLength,
          checksumSha256: sha256(PDF),
          vehicleId: vehicle.id,
          documentType: 'INSPECTION_CERTIFICATE',
        }),
      })
    ).json()
  ).data
  const put = await fetch(session.upload.url, {
    method: 'PUT',
    headers: session.upload.headers,
    body: new Uint8Array(PDF),
  })
  const finalised = await (
    await call(owner, `/documents/${session.documentId}/finalise`, { method: 'POST' })
  ).json()
  put.ok && finalised.data.status === 'AVAILABLE'
    ? ok(`uploaded straight to storage and verified (${session.upload.expiresInSeconds}s window)`)
    : fail(`upload/finalise failed: ${put.status} ${JSON.stringify(finalised)}`)

  console.log('\n[2] The key is tenant-namespaced and carries no filename')
  const key = sql(`SELECT storage_key FROM documents WHERE id = '${session.documentId}';`)
  const shaped = new RegExp(`^workspaces/${owner.ws}/\\d{4}/\\d{2}/[0-9a-f-]+\\.pdf$`)
  shaped.test(key) && !/certificate/i.test(key) ? ok(`key: ${key}`) : fail(`unexpected key: ${key}`)

  console.log('\n[3] The bucket is private — the key alone opens nothing')
  const direct = await fetch(`${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`)
  direct.status === 403 || direct.status === 401
    ? ok(`unsigned request refused (${direct.status})`)
    : fail(`object is reachable without a signature: ${direct.status}`)

  console.log('\n[4] A signed link returns the bytes, as an attachment')
  const link = (await (await call(owner, `/documents/${session.documentId}/download`)).json()).data
  const fetched = await fetch(link.url)
  const body = Buffer.from(await fetched.arrayBuffer())
  const disposition = fetched.headers.get('content-disposition') ?? ''
  body.equals(PDF) && disposition.includes('attachment') && link.expiresInSeconds === 300
    ? ok(`bytes match, ${disposition}, valid ${link.expiresInSeconds}s`)
    : fail(`download wrong: ${fetched.status} ${disposition}`)

  console.log('\n[5] Another workspace cannot reach it')
  const cross = await fetch(
    `${API}/workspaces/${other.ws}/documents/${session.documentId}/download`,
    { headers: { cookie: other.cookie } },
  )
  cross.status === 404
    ? ok('cross-tenant download returns 404, not 403 — existence is not confirmed')
    : fail(`cross-tenant download returned ${cross.status}`)

  console.log('\n[6] A file that is not what it claimed is quarantined, not served')
  const html = Buffer.from('<html><script>alert(1)</script></html>')
  const s2 = (
    await (
      await call(owner, '/documents/upload-session', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          byteSize: html.byteLength,
          checksumSha256: sha256(html),
          vehicleId: vehicle.id,
        }),
      })
    ).json()
  ).data
  await fetch(s2.upload.url, {
    method: 'PUT',
    headers: s2.upload.headers,
    body: new Uint8Array(html),
  })
  const bad = await call(owner, `/documents/${s2.documentId}/finalise`, { method: 'POST' })
  const status = sql(`SELECT status FROM documents WHERE id = '${s2.documentId}';`)
  const dl = await call(owner, `/documents/${s2.documentId}/download`)
  bad.status === 422 && status === 'QUARANTINED' && dl.status === 404
    ? ok('HTML declared as PDF was quarantined and is not downloadable')
    : fail(`expected quarantine; got ${bad.status}/${status}/${dl.status}`)

  console.log('\n[7] SVG is refused outright')
  const svg = await call(owner, '/documents/upload-session', {
    method: 'POST',
    body: JSON.stringify({
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
      byteSize: 100,
      checksumSha256: sha256(Buffer.from('x')),
    }),
  })
  svg.status === 422 ? ok('SVG rejected (script execution vector)') : fail(`got ${svg.status}`)

  console.log('\n[8] Scan status is honest about there being no scanner')
  const scan = sql(`SELECT scan_status FROM documents WHERE id = '${session.documentId}';`)
  scan === 'SKIPPED'
    ? ok('scan_status is SKIPPED, not a fictitious CLEAN')
    : fail(`scan_status is ${scan}`)

  console.log('\n[9] Deleting is soft, and stops the download immediately')
  await call(owner, `/documents/${session.documentId}`, { method: 'DELETE' })
  const after = sql(
    `SELECT status || ':' || (deleted_at IS NOT NULL)::text FROM documents WHERE id = '${session.documentId}';`,
  )
  const gone = await call(owner, `/documents/${session.documentId}/download`)
  after === 'DELETED:true' && gone.status === 404
    ? ok('row retained, marked deleted, download refused')
    : fail(`unexpected: ${after} / ${gone.status}`)

  console.log('\n[10] The audit trail records access without leaking the key')
  const actions = sql(
    `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_logs
      WHERE workspace_id = '${owner.ws}' AND resource_type = 'document';`,
  )
  const leaked = sql(
    `SELECT count(*) FROM audit_logs WHERE resource_type = 'document' AND metadata::text LIKE '%workspaces/%';`,
  )
  actions.includes('document.downloaded') &&
  actions.includes('document.quarantined') &&
  leaked === '0'
    ? ok(`audited: ${actions}`)
    : fail(`audit wrong: "${actions}", leaked=${leaked}`)
} finally {
  for (const email of emails) {
    const wsq = `(SELECT id FROM workspaces WHERE owner_user_id IN (SELECT id FROM users WHERE email='${email}'))`
    sql(`DELETE FROM documents WHERE workspace_id IN ${wsq};`)
    sql(`DELETE FROM reminders WHERE workspace_id IN ${wsq};`)
    sql(`DELETE FROM notifications WHERE workspace_id IN ${wsq};`)
  }
}

console.log(process.exitCode ? '\nDOCUMENT VERIFICATION FAILED\n' : '\nDOCUMENT VAULT VERIFIED\n')
