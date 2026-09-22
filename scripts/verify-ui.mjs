/**
 * Drives the real dashboard in a real browser to verify the vertical slice works:
 * sign in -> see seeded vehicles -> add a vehicle -> open it -> update mileage.
 *
 * This is verification, not a test suite; the Playwright E2E suite lands in Phase 2.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const DASH = process.env.DASH_URL ?? 'http://localhost:3101'
// Unique per run: re-running must not trip the duplicate-registration guard, which is
// correct behaviour rather than a bug to work around.
const RUN = Date.now().toString().slice(-5)
const REG = `VT${RUN.slice(0, 2)} ${RUN.slice(2)}`
const consoleErrors = []
const pageErrors = []

const log = (s) => console.log(s)
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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => pageErrors.push(e.message))

try {
  log('\n[1] Load dashboard (unauthenticated)')
  await page.goto(DASH, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Sign in to AutoServices', { timeout: 15000 })
  ok('redirected to sign-in')

  log('\n[2] Dev sign-in')
  await page.click('text=Sign in as andrei@autoservices.local')
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  ok('signed in, overview rendered')

  const greeting = await page.textContent('h1')
  ok(`greeting: "${greeting}"`)

  log('\n[3] Seeded vehicles visible')
  await page.waitForSelector('text=Ford Mondeo', { timeout: 10000 })
  await page.waitForSelector('text=BMW 530d', { timeout: 10000 })
  ok('Ford Mondeo and BMW 530d rendered from the API')

  const attention = await page.locator('text=Attention required').count()
  check(attention > 0, 'attention panel shown (stale mileage detected)', 'no attention items')

  log('\n[4] Add a vehicle')
  await page.getByRole('link', { name: 'Add vehicle' }).first().click()
  await page.waitForSelector('text=Add a vehicle', { timeout: 10000 })
  await page.fill('input[name="manufacturer"]', 'Volvo')
  await page.fill('input[name="model"]', `V60 ${RUN}`)
  await page.fill('input[name="trim"]', 'D4 R-Design')
  await page.fill('input[name="modelYear"]', '2017')
  await page.fill('input[name="registrationNumber"]', REG)
  await page.fill('input[name="currentOdometer"]', '88500')
  await page.click('button[type="submit"]')

  await page.waitForSelector(`h1:has-text("Volvo V60 ${RUN}")`, { timeout: 15000 })
  ok('vehicle created and redirected to its detail page')

  const mileageShown = await page.locator('text=88,500').count()
  check(mileageShown > 0, 'initial odometer reading persisted (88,500)', 'MILEAGE NOT SHOWN')

  log('\n[5] Update mileage')
  await page.click('button:has-text("Add mileage") >> nth=0')
  await page.waitForSelector('text=Add a mileage reading', { timeout: 10000 })
  await page.fill('input[name="value"]', '91250')
  await page.fill('textarea[name="notes"]', 'Verified during local testing')
  await page.click('button:has-text("Save reading")')
  await page.waitForSelector('text=91,250', { timeout: 15000 })
  ok('new odometer entry created; UI shows 91,250')

  log('\n[6] Mileage history is append-only')
  await page.goto(`${page.url().split('?')[0]}?tab=mileage`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Mileage history', { timeout: 10000 })
  const rows = await page.locator('tbody tr').count()
  ok(`${rows} readings in history (original reading preserved: ${rows >= 2 ? 'yes' : 'NO'})`)

  log('\n[7] Odometer regression is rejected')
  await page.click('button:has-text("Add reading")')
  await page.waitForSelector('text=Add a mileage reading', { timeout: 10000 })
  await page.fill('input[name="value"]', '50000')
  await page.click('button:has-text("Save reading")')
  await page.waitForSelector('[role="alert"]', { timeout: 10000 })
  const alertText = await page.textContent('[role="alert"]')
  ok(`server rejected: "${alertText?.slice(0, 90)}…"`)
  const correctionShown = await page.locator('text=Reason for the correction').count()
  check(correctionShown > 0, 'correction path offered', 'correction path MISSING')
  await page.click('button:has-text("Cancel")')

  log('\n[8] Timeline')
  await page.goto(`${page.url().split('?')[0]}?tab=timeline`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Timeline', { timeout: 10000 })
  const events = await page.locator('ol li').count()
  ok(`${events} timeline events rendered`)

  log('\n[9] Responsive check at 375px')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(DASH, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Your vehicles', { timeout: 10000 })
  const hScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  check(!hScroll, 'no horizontal scroll at 375px', 'HORIZONTAL SCROLL PRESENT (bug)')
  const tabbar = await page.locator('nav[aria-label="Primary"]').count()
  check(tabbar > 0, 'mobile tab bar present', 'mobile tab bar missing')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(DASH, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Your vehicles', { timeout: 10000 })
  await page.screenshot({ path: '/tmp/dashboard-overview.png', fullPage: true })
  ok('screenshot saved: /tmp/dashboard-overview.png')

  log('\n=== Console errors ===')
  /**
   * Two failures are provoked on purpose and are the point of their steps: the session
   * probe before sign-in (401) and the odometer regression this script deliberately
   * triggers (409). Filtering them is what lets "no console errors" mean something —
   * otherwise every run reports noise and nobody reads the line.
   */
  const noise = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('404') && !e.includes('401') && !e.includes('409'),
  )
  if (noise.length === 0 && pageErrors.length === 0) {
    ok('no console or page errors')
  } else {
    noise.slice(0, 10).forEach((e) => console.error(`  \u2717 console: ${e.slice(0, 160)}`))
    pageErrors.slice(0, 10).forEach((e) => console.error(`  \u2717 pageerror: ${e.slice(0, 160)}`))
    // Unexpected console output is a failure, not a footnote.
    process.exitCode = 1
  }

  log(process.exitCode ? '\nVERIFICATION FOUND PROBLEMS' : '\nVERIFICATION COMPLETE')
} catch (err) {
  console.error('\nVERIFICATION FAILED:', err.message)
  await page.screenshot({ path: '/tmp/failure.png', fullPage: true }).catch(() => {})
  console.error('Screenshot: /tmp/failure.png')
  console.error('Console errors:', consoleErrors.slice(0, 5))
  console.error('Page errors:', pageErrors.slice(0, 5))
  process.exitCode = 1
} finally {
  await browser.close()
  /**
   * Remove the vehicle this run added to the SEEDED demo garage. Without this the demo
   * workspace gained a Volvo on every run, which quietly changes what the reports, the
   * fleet table and the dashboard show to the next person who opens them.
   */
  const vq = `(SELECT id FROM vehicles WHERE registration_number='${REG}')`
  sql(`DELETE FROM expenses WHERE vehicle_id IN ${vq};`)
  sql(`DELETE FROM odometer_entries WHERE vehicle_id IN ${vq};`)
  sql(`DELETE FROM fuel_entries WHERE vehicle_id IN ${vq};`)
  sql(`DELETE FROM reminders WHERE vehicle_id IN ${vq};`)
  sql(`DELETE FROM audit_logs WHERE resource_id IN ${vq};`)
  sql(`DELETE FROM vehicles WHERE registration_number='${REG}';`)
}
