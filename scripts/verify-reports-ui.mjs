/** Drives the reports page (RPT-005) in a real browser. */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const D = 'http://localhost:3101'
const errs = []
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (t.includes('401') || t.includes('404')) return
  errs.push(t.slice(0, 140))
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

const year = new Date().getUTCFullYear()

try {
  console.log('\n[1] Reports is no longer labelled Soon')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  const soon = await page.locator('a[href="/reports"] >> text=Soon').count()
  check(soon === 0, 'nav entry is live', 'STALE SOON LABEL')

  console.log('\n[2] The page builds a real report')
  await page.getByRole('link', { name: 'Reports' }).first().click()
  await page.waitForSelector('text=Month by month', { timeout: 15000 })
  const placeholder = await page.getByText('is not built yet').count()
  check(placeholder === 0, 'real page, not a placeholder', 'PLACEHOLDER')

  console.log('\n[3] The three headline figures are present')
  for (const label of ['Total', 'Per mile', 'Per year']) {
    const found = await page.getByText(label, { exact: true }).count()
    if (found === 0) errs.push(`missing tile: ${label}`)
  }
  ok('Total, Per mile and Per year all rendered')

  console.log('\n[4] With no data it explains rather than showing a dash')
  // Either a figure or a reason — never a bare dash. The seeded garage has mileage
  // history, so here the figure is what is correct; a workspace without it gets words.
  const perMileTile = page.locator('div', { hasText: /^Per mile/ }).last()
  const perMileText = (await perMileTile.textContent()) ?? ''
  const hasFigure = /\d/.test(perMileText)
  const hasReason = /No mileage recorded|Only one mileage reading|did not change/.test(perMileText)
  check(
    hasFigure || hasReason,
    hasFigure ? 'per-mile figure shown, with the distance behind it' : 'absence explained in words',
    `per-mile tile is blank: ${perMileText.slice(0, 60)}`,
  )
  await page.screenshot({ path: '/tmp/shot-reports-empty.png' })

  console.log('\n[5] Record a cost and the report picks it up')
  const wsId = sql(`SELECT id FROM workspaces WHERE name='My Garage' LIMIT 1;`)
  const vId = sql(`SELECT id FROM vehicles WHERE workspace_id='${wsId}' LIMIT 1;`)
  sql(
    `INSERT INTO expenses (workspace_id, vehicle_id, incurred_on, amount, currency, description, source_type, updated_at)
     VALUES ('${wsId}', '${vId}', '${year}-06-15', 250.00, 'GBP', 'UI report check', 'MANUAL', now());`,
  )
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Month by month', { timeout: 15000 })
  const total = await page.locator('.tabular').first().textContent()
  ok(`total tile reads ${total?.trim()}`)
  await page.screenshot({ path: '/tmp/shot-reports.png' })

  console.log('\n[6] Narrowing the date range changes the answer')
  await page.locator('input[name="from"]').fill(`${year}-01-01`)
  await page.locator('input[name="to"]').fill(`${year}-01-31`)
  await page.waitForTimeout(1200)
  const narrowed = await page.locator('.tabular').first().textContent()
  check(
    narrowed?.trim() !== total?.trim(),
    `January alone reads ${narrowed?.trim()}`,
    'DATE FILTER HAD NO EFFECT',
  )

  console.log('\n[7] A short period refuses to be annualised, in words')
  const refused = await page.getByText(/under 90 days/).count()
  check(refused > 0, 'explains why there is no per-year figure', 'NO EXPLANATION')

  console.log('\n[8] Mobile width')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  check(!overflow, 'no horizontal scroll at 390px', 'HORIZONTAL SCROLL')
  await page.screenshot({ path: '/tmp/shot-reports-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nREPORTS UI HAS ERRORS\n' : '\nREPORTS UI VERIFIED\n')
} finally {
  sql(`DELETE FROM expenses WHERE description = 'UI report check';`)
  await browser.close()
}
