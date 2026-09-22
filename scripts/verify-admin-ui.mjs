/** Drives the admin console against the real API. */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

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
const A = 'http://localhost:3102'
const errs = []
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
/**
 * The console probes its own session on load and after sign-out, and the API answers 404
 * when there is none — that is the design, not a fault. Everything else is reported.
 */
let expectSessionProbe = true
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (expectSessionProbe && text.includes('404')) return
  errs.push(text.slice(0, 140))
})
const ok = (s) => console.log(`  ✓ ${s}`)

/**
 * Asserts a condition. A failing check must FAIL: the earlier shape,
 * `ok(cond ? 'good' : 'BAD')`, printed a tick beside the failure text and left the exit
 * code at zero, so a broken expectation looked like a passing one.
 */
const check = (condition, good, bad) => {
  if (condition) {
    console.log(`  \u2713 ${good}`)
  } else {
    console.error(`  \u2717 ${bad}`)
    errs.push(bad)
    process.exitCode = 1
  }
}

/**
 * The table element only exists once there are rows, so a bare waitForSelector('table')
 * can match the PREVIOUS route's table during client-side navigation and count zero.
 * Wait for a real row (or a genuine empty state) belonging to the page we are on.
 */
async function settledRows(page) {
  await Promise.race([
    page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 15000 }),
    page.locator('text=/No .* (yet|found)/').first().waitFor({ state: 'visible', timeout: 15000 }),
  ])
  return page.locator('tbody tr').count()
}

const { hashPassword, generateTotpSecret, sealSecret, totpCode } = await import(
  '../packages/auth/dist/index.js'
)
const dotenv = (await import('dotenv')).default
dotenv.config({ path: new URL('../.env', import.meta.url).pathname, quiet: true })

/**
 * The console now requires a real staff account (ADMIN-001), so this creates one with a
 * runtime-generated secret and signs in through the form. Nothing is committed.
 */
// Admin sign-in is rate-limited to 5 per 15 minutes (SEC-009), which repeated runs of
// this script legitimately trip. Local development only.
execFileSync(
  'bash',
  [
    '-c',
    "docker exec -i autoservices-redis redis-cli --scan --pattern 'rl:*' | " +
      'xargs -r docker exec -i autoservices-redis redis-cli DEL',
  ],
  { encoding: 'utf8' },
)

const ADMIN_PASSWORD = 'AdminUiCheck123!'
const adminEmail = `admin-ui-${Date.now()}@example.com`
const adminSecret = generateTotpSecret()
psql(
  `INSERT INTO admin_users
     (email, password_hash, role, status, mfa_secret, mfa_enrolled_at, updated_at)
   VALUES ('${adminEmail}', '${await hashPassword(ADMIN_PASSWORD)}', 'SUPER_ADMIN', 'ACTIVE',
           '${sealSecret(adminSecret, process.env.SESSION_SECRET)}', now(), now());`,
)

try {
  console.log('\n[0] Sign in to the staff realm')
  await page.goto(A, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Operations console', { timeout: 15000 })
  await page.fill('input[name="email"]', adminEmail)
  await page.fill('input[name="password"]', ADMIN_PASSWORD)
  await page.fill('input[name="totpCode"]', totpCode(adminSecret))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('text=System overview', { timeout: 20000 })
  expectSessionProbe = false
  ok('signed in with password and authenticator code')

  console.log('\n[1] Overview with real metrics')
  await page.waitForSelector('text=System overview', { timeout: 15000 })
  await page.waitForSelector('text=Vehicles', { timeout: 10000 })
  const tiles = await page.locator('text=Active reminders').count()
  ok(`overview rendered, metrics tiles present (${tiles})`)

  console.log('\n[2] Email delivery page')
  await page.getByRole('link', { name: 'Emails' }).click()
  await page.waitForSelector('text=Email delivery', { timeout: 15000 })
  const rows = await settledRows(page)
  ok(`email table rendered with ${rows} row(s)`)
  const statuses = await page.locator('tbody tr td:first-child').allTextContents()
  ok(`statuses: ${[...new Set(statuses)].join(', ') || '(none)'}`)
  await page.screenshot({ path: '/tmp/shot-admin-emails.png' })

  console.log('\n[3] Expand a message to see its event history')
  const eventsLink = page.locator('tbody tr td:last-child button').first()
  if ((await eventsLink.count()) > 0) {
    await eventsLink.click()
    await page.waitForSelector('text=correlation:', { timeout: 10000 })
    const evRows = await page.locator('text=email.').count()
    ok(`event history expanded (${evRows} event row(s))`)
  } else {
    ok('no message with events to expand')
  }

  console.log('\n[4] Jobs page')
  await page.getByRole('link', { name: 'Jobs' }).click()
  await page.waitForSelector('text=Background jobs', { timeout: 15000 })
  await page.waitForSelector('text=Queues', { timeout: 10000 })
  const qRows = await settledRows(page)
  ok(`queue table rendered with ${qRows} row(s)`)
  await page.screenshot({ path: '/tmp/shot-admin-jobs.png' })

  console.log('\n[5] Audit page')
  await page.getByRole('link', { name: 'Audit logs' }).click()
  await page.waitForSelector('text=Audit log', { timeout: 15000 })
  await page.waitForSelector('text=Recent activity', { timeout: 10000 })
  const aRows = await settledRows(page)
  ok(`audit table rendered with ${aRows} entr(ies)`)

  console.log('\n[6] Suppressions page, with a seeded entry')
  // Seeded directly so the page is exercised with content rather than an empty state.
  const SUP = `admin-ui-check-${Date.now()}@example.com`
  psql(
    `INSERT INTO email_suppressions (email, reason, detail) ` +
      `VALUES ('${SUP}', 'HARD_BOUNCE', 'seeded by verify-admin-ui');`,
  )
  await page.getByRole('link', { name: 'Suppressions' }).click()
  await page.waitForSelector('text=Suppressed addresses', { timeout: 15000 })
  const sRows = await settledRows(page)
  ok(`suppression table rendered with ${sRows} row(s)`)
  if ((await page.locator(`text=${SUP}`).count()) > 0) {
    ok('the seeded address is listed')
  } else {
    errs.push('seeded suppression not shown')
  }
  await page.screenshot({ path: '/tmp/shot-admin-suppressions.png' })

  await page.getByRole('button', { name: 'Release' }).first().click()
  await page.waitForFunction((email) => !document.body.innerText.includes(email), SUP, {
    timeout: 10000,
  })
  const stillThere = psql(
    `SELECT released_at IS NOT NULL FROM email_suppressions WHERE email = '${SUP}';`,
  )
  check(
    stillThere === 't',
    'released from the UI, and the row is kept as history',
    'RELEASE DID NOT KEEP HISTORY',
  )
  psql(`DELETE FROM email_suppressions WHERE email = '${SUP}';`)

  console.log('\n[7] Support access register')
  // Seeded directly so the page is exercised with content. A live grant here is exactly
  // what a reviewer is meant to notice.
  const subject = psql(`SELECT id FROM workspaces ORDER BY created_at LIMIT 1;`)
  psql(
    `INSERT INTO support_access_grants
       (admin_user_id, workspace_id, reason, scope, expires_at, updated_at)
     VALUES ((SELECT id FROM admin_users WHERE email='${adminEmail}'), '${subject}',
             'UI check: customer cannot find their MOT certificate after renewal.',
             'VEHICLE_CONTENT', now() + interval '2 hours', now());`,
  )
  await page.getByRole('link', { name: 'Support access' }).click()
  await page.waitForSelector('text=Grants', { timeout: 15000 })
  const grantRows = await settledRows(page)
  ok(`register rendered with ${grantRows} grant(s)`)
  const explains = await page.getByText('every use is recorded').count()
  check(explains > 0, 'page states that every use is recorded', 'EXPLANATION MISSING')
  const reasonShown = await page.getByText('cannot find their MOT certificate').count()
  check(reasonShown > 0, 'the written reason is shown in full', 'REASON HIDDEN')
  await page.screenshot({ path: '/tmp/shot-support-access.png' })

  await page.getByRole('button', { name: 'Revoke' }).first().click()
  // Wait for the action to disappear rather than for the word "live": the empty state
  // itself reads "No live support access".
  await page
    .getByRole('button', { name: 'Revoke' })
    .first()
    .waitFor({ state: 'detached', timeout: 10000 })
  const stillLive = psql(
    `SELECT count(*) FROM support_access_grants WHERE revoked_at IS NULL AND expires_at > now();`,
  )
  check(
    stillLive === '0',
    'revoked from the console, and recorded as revoked',
    'REVOKE DID NOT PERSIST',
  )

  console.log('\n[8] Signing out ends the session')
  expectSessionProbe = true
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForSelector('text=Operations console', { timeout: 15000 })
  const backIn = await page.locator('input[name="totpCode"]').count()
  check(backIn > 0, 'returned to sign-in, session cleared', 'STILL SIGNED IN')

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nADMIN UI HAS ERRORS\n' : '\nADMIN UI VERIFIED')
} catch (e) {
  console.error('\nFAILED:', e.message)
  await page.screenshot({ path: '/tmp/admin-fail.png' }).catch(() => {})
  console.error('errors:', errs.slice(0, 4))
  process.exitCode = 1
} finally {
  psql(
    `DELETE FROM audit_logs WHERE actor_admin_id IN (SELECT id FROM admin_users WHERE email='${adminEmail}');`,
  )
  psql(
    `DELETE FROM admin_sessions WHERE admin_user_id IN (SELECT id FROM admin_users WHERE email='${adminEmail}');`,
  )
  psql(`DELETE FROM admin_users WHERE email='${adminEmail}';`)
  await browser.close()
}
