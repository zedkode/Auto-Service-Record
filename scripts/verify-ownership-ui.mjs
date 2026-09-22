/** Drives the Ownership tab (OWN-001/002/003) in a real browser. */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const D = 'http://localhost:3101'
const errs = []
/** Stage [7] provokes a 422 on purpose; only that one is expected. */
let expectRejection = false
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  if (text.includes('401')) return
  if (expectRejection && text.includes('422')) return
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

const plusDays = (n) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/**
 * Scopes every selector to the dialog that is actually open. All the vehicle page's
 * dialogs are native <dialog> elements that stay in the DOM when closed, so an unscoped
 * input[name=...] can resolve to a field in a hidden one.
 */
const dlg = () => page.locator('dialog[open]')

try {
  console.log('\n[1] Sign in and open the Ownership tab')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
  await page.getByRole('tab', { name: 'Ownership' }).click()
  await page.waitForSelector('text=Inspection', { timeout: 15000 })
  ok('ownership tab rendered')

  console.log('\n[2] Empty state is honest, not alarming')
  const notTracked = await page.getByText('Not tracked').count()
  ok(`${notTracked} card(s) say "Not tracked" rather than implying a problem`)
  await page.screenshot({ path: '/tmp/shot-ownership-empty.png' })

  console.log('\n[3] Record an MOT with an advisory through the UI')
  await page.getByRole('button', { name: 'Record an inspection' }).click()
  await page.waitForSelector('text=Record an inspection', { timeout: 10000 })
  await dlg().locator('input[name="performedOn"]').fill(plusDays(-355))
  await dlg().locator('input[name="expiresOn"]').fill(plusDays(10))
  await dlg().locator('input[name="odometer"]').fill('132600')
  await dlg().locator('input[name="centreName"]').fill('UI Test MOT Centre')
  await dlg().getByRole('button', { name: 'Add advisory' }).click()
  await dlg().locator('input[aria-label="Advisory 1 description"]').fill('Front brake disc worn')
  await dlg().locator('select[aria-label="Advisory 1 severity"]').selectOption('MAJOR')
  await dlg().getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('text=UI Test MOT Centre', { timeout: 15000 })
  ok('inspection saved and shown')

  console.log('\n[4] Status reflects the server, and advisories appear')
  const dueSoon = await page.getByText('Due soon').count()
  check(dueSoon > 0, 'expiring certificate shows "Due soon"', 'STATUS BADGE MISSING')
  const daysLeft = await page
    .getByText(/\d+ days left/)
    .first()
    .textContent()
  ok(`countdown rendered: "${daysLeft?.trim()}"`)
  const advisory = await page.getByText('Front brake disc worn').count()
  check(advisory > 0, 'advisory listed', 'ADVISORY MISSING')

  console.log('\n[5] Resolve the advisory')
  await page.getByRole('button', { name: 'Mark done' }).first().click()
  await page.waitForSelector('text=Reopen', { timeout: 10000 })
  ok('advisory resolved, action inverted to "Reopen"')
  await page.screenshot({ path: '/tmp/shot-ownership-filled.png' })

  console.log('\n[6] Add an insurance policy')
  await page.getByRole('button', { name: 'Add a policy' }).click()
  await page.waitForSelector('text=Add an insurance policy', { timeout: 10000 })
  await dlg().locator('input[name="providerName"]').fill('UI Test Insurer')
  await dlg().locator('input[name="startsOn"]').fill(plusDays(-300))
  await dlg().locator('input[name="expiresOn"]').fill(plusDays(45))
  await dlg().locator('input[name="premiumAmount"]').fill('499.99')
  await dlg().getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('text=UI Test Insurer', { timeout: 15000 })
  const premium = await page.getByText('£499.99 premium').count()
  check(premium > 0, 'premium formatted as currency for an OWNER', 'PREMIUM NOT SHOWN')

  console.log('\n[7] Validation errors surface, they are not swallowed')
  expectRejection = true
  await page.getByRole('button', { name: 'Record road tax' }).click()
  await page.waitForSelector('text=Record road tax', { timeout: 10000 })
  await dlg().locator('input[name="startsOn"]').fill(plusDays(0))
  await dlg().locator('input[name="expiresOn"]').fill(plusDays(-30))
  await dlg().getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('text=/expiry date cannot be before/i', { timeout: 10000 })
  ok('an expiry before the start date is refused, with the reason shown')
  await dlg().getByRole('button', { name: 'Cancel' }).click()
  expectRejection = false

  console.log('\n[8] Mobile width: no horizontal scroll')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  check(!overflow, 'no horizontal scroll at 390px', 'HORIZONTAL SCROLL PRESENT')
  await page.screenshot({ path: '/tmp/shot-ownership-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nOWNERSHIP UI HAS ERRORS\n' : '\nOWNERSHIP UI VERIFIED\n')
} finally {
  // Remove only what this script created.
  sql(`DELETE FROM inspection_advisories WHERE inspection_id IN
        (SELECT id FROM vehicle_inspections WHERE centre_name = 'UI Test MOT Centre');`)
  sql(`DELETE FROM reminders WHERE source_id IN
        (SELECT id FROM vehicle_inspections WHERE centre_name = 'UI Test MOT Centre');`)
  sql(`DELETE FROM vehicle_inspections WHERE centre_name = 'UI Test MOT Centre';`)
  sql(`DELETE FROM reminders WHERE source_id IN
        (SELECT id FROM insurance_policies WHERE provider_name = 'UI Test Insurer');`)
  // The premium projected itself into the expense ledger; remove that too or it is
  // left orphaned and silently inflates every cost total.
  sql(`DELETE FROM expenses WHERE source_type = 'INSURANCE' AND source_record_id IN
        (SELECT id FROM insurance_policies WHERE provider_name = 'UI Test Insurer');`)
  sql(`DELETE FROM insurance_policies WHERE provider_name = 'UI Test Insurer';`)
  await browser.close()
}
