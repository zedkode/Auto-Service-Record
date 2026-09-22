/** Drives the new service + maintenance UI in a real browser. */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
const D = 'http://localhost:3101'
const errs = []
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('401')) errs.push(m.text().slice(0, 140))
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
 * Counts matches once the number has stopped changing.
 *
 * `waitForSelector` resolves on the element it first sees, and React then replaces that
 * node when the query settles — so a `.count()` taken immediately afterwards lands in the
 * gap and returns 0. This is the third time that race has produced a false failure in
 * these scripts, so it gets a helper rather than another sleep (DECISIONS.md D-102).
 */
async function settledCount(selector, { timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout
  let previous = -1
  while (Date.now() < deadline) {
    const count = await page.locator(selector).count()
    if (count > 0 && count === previous) return count
    previous = count
    await page.waitForTimeout(150)
  }
  return previous
}

try {
  console.log('\n[1] Sign in')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  ok('signed in')

  console.log('\n[2] Open a vehicle, Maintenance tab')
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
  await page.getByRole('tab', { name: 'Maintenance' }).click()
  /**
   * Wait for a RULE, not for the card heading. The heading renders while the rules are
   * still loading, so the counts below were taken against an empty list — and reported
   * "0 combined-interval items" through `ok()`, which made an empty panel look like a
   * passing check (the same masked-failure shape as DECISIONS.md D-079).
   */
  const rows = await settledCount('text=whichever comes first')
  check(
    rows > 0,
    `maintenance schedule rendered (${rows} combined-interval items)`,
    'NO COMBINED-INTERVAL RULES RENDERED',
  )
  const disclaimer = await settledCount('text=not manufacturer specifications')
  check(disclaimer > 0, 'interval disclaimer shown (honest about provenance)', 'DISCLAIMER MISSING')

  console.log('\n[3] Record a service through the UI')
  await page.getByRole('button', { name: 'Add service' }).first().click()
  await page.waitForSelector('text=Record a service', { timeout: 10000 })
  const stamp = Date.now().toString().slice(-6)
  await page.fill('input[name="title"]', `Brake fluid change ${stamp}`)
  await page.selectOption('select[name="categoryId"]', { label: 'Brake Fluid' })
  await page.fill('input[name="odometer"]', '132500')
  await page.fill('input[name="workshopName"]', 'UI Test Garage')
  await page.fill('input[name="totalAmount"]', '78.50')
  await page.getByRole('button', { name: /More details/ }).click()
  await page.getByRole('button', { name: 'Add a part' }).click()
  await page.fill('input[aria-label="Part 1 name"]', 'DOT 4 brake fluid 1L')
  await page.fill('input[aria-label="Part 1 brand"]', 'Bosch')
  await page.fill('input[aria-label="Part 1 price"]', '12.00')
  await page.getByRole('button', { name: 'Save service' }).click()
  await page.waitForSelector('text=Record a service', { state: 'hidden', timeout: 20000 })
  ok('service saved and dialog closed')

  console.log('\n[4] Maintenance advanced automatically')
  await page.waitForTimeout(1200)
  const bfRow = page.locator('li', { hasText: 'Brake Fluid' }).first()
  const bfText = await bfRow.textContent()
  ok(`brake fluid row now reads: "${bfText?.replace(/\s+/g, ' ').trim().slice(0, 90)}…"`)

  console.log('\n[5] Service appears in history with its parts')
  await page.getByRole('tab', { name: 'Service' }).click()
  await page.waitForSelector('text=Service history', { timeout: 10000 })
  await page.waitForSelector(`text=Brake fluid change ${stamp}`, { timeout: 10000 })
  ok('service listed in history')
  await page.click(`text=Brake fluid change ${stamp}`)
  await page.waitForSelector('text=Parts fitted', { timeout: 10000 })
  ok('detail dialog shows cost breakdown and parts')
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  console.log('\n[6] Timeline includes the service')
  await page.getByRole('tab', { name: 'Timeline' }).click()
  /**
   * Wait for the PANEL, not for the word "Timeline" — that also matches the tab button,
   * which is on screen before the panel has rendered, so the assertion below ran against
   * the previous tab's content and reported a service that was in fact there as missing.
   */
  await page.waitForSelector('text=Every recorded event', { timeout: 10000 })
  const svcOnTimeline = await page.locator(`text=Brake fluid change ${stamp}`).count()
  check(svcOnTimeline > 0, 'service event on the timeline', 'SERVICE MISSING FROM TIMELINE')

  console.log('\n[7] Overview shows real costs and maintenance')
  await page.getByRole('tab', { name: 'Overview' }).click()
  await page.waitForSelector('text=Running costs', { timeout: 10000 })
  const costCard = await page.locator('text=Running costs').locator('xpath=../..').textContent()
  ok(`running costs card: "${costCard?.replace(/\s+/g, ' ').trim().slice(0, 80)}…"`)

  console.log('\n[8] Workspace-wide pages')
  await page.goto(`${D}/service`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Service history', { timeout: 10000 })
  const wsRows = await page.locator('tbody tr').count()
  ok(`workspace service history: ${wsRows} records with filters`)
  await page.goto(`${D}/maintenance`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Needs attention', { timeout: 10000 })
  ok('workspace maintenance page rendered')

  console.log('\n[9] Mobile 390px')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${D}/service`, { waitUntil: 'networkidle' })
  await page.waitForSelector('text=Service history', { timeout: 10000 })
  const h = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  check(!h, 'no horizontal scroll', 'HORIZONTAL SCROLL (bug)')

  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(`${D}/vehicles`, { waitUntil: 'networkidle' })
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")')
  await page.getByRole('tab', { name: 'Maintenance' }).click()
  await page.waitForSelector('text=Maintenance schedule')
  await page.screenshot({ path: '/tmp/shot-maintenance.png' })
  await page.getByRole('tab', { name: 'Service' }).click()
  await page.waitForSelector('text=Service history')
  await page.screenshot({ path: '/tmp/shot-service.png' })
  ok('screenshots captured')

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 5).join(' | ') : 'none'}`)
  // The verdict has to agree with the exit code. This line used to read VERIFIED beside a
  // failed check, which is the same masked-failure shape as DECISIONS.md D-079.
  console.log(
    errs.length ? '\nSERVICE + MAINTENANCE UI HAS ERRORS' : '\nSERVICE + MAINTENANCE UI VERIFIED',
  )
} catch (e) {
  console.error('\nFAILED:', e.message)
  await page.screenshot({ path: '/tmp/ui-fail.png' }).catch(() => {})
  console.error('errors:', errs.slice(0, 5))
  process.exitCode = 1
} finally {
  await browser.close()
  // Remove the service this run added to the SEEDED demo vehicle, so repeated runs do not
  // accumulate history that changes what the next person sees.
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
  const sq = `(SELECT id FROM service_records WHERE workshop_name = 'UI Test Garage')`
  sql(`DELETE FROM expenses WHERE source_type='SERVICE' AND source_record_id IN ${sq};`)
  sql(`DELETE FROM odometer_entries WHERE source_record_id IN ${sq};`)
  sql(`DELETE FROM maintenance_completions WHERE service_record_id IN ${sq};`)
  sql(`DELETE FROM service_record_parts WHERE service_record_id IN ${sq};`)
  sql(`DELETE FROM service_records WHERE workshop_name = 'UI Test Garage';`)
}
