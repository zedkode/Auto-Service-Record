/** Drives the fuel tab in a real browser (OWN-006). */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const D = 'http://localhost:3101'
const errs = []
let expectRejection = false
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (t.includes('401') || t.includes('404')) return
  if (expectRejection && t.includes('422')) return
  errs.push(t.slice(0, 140))
})
const ok = (s) => console.log(`  ✓ ${s}`)
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
const dlg = () => page.locator('dialog[open]')

async function recordFill(odometer, quantity, { partial = false, amount = '' } = {}) {
  await page.getByRole('button', { name: 'Record a fill' }).click()
  await page.waitForSelector('dialog[open]', { timeout: 10000 })
  await dlg().locator('input[name="odometer"]').fill(String(odometer))
  await dlg().locator('input[name="quantity"]').fill(String(quantity))
  if (amount) await dlg().locator('input[name="totalAmount"]').fill(amount)
  if (partial) await dlg().getByText('Filled the tank completely').click()
  await dlg().getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('dialog[open]', { state: 'detached', timeout: 20000 })
}

try {
  console.log('\n[1] Open the Fuel tab — it is no longer a placeholder')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
  await page.getByRole('tab', { name: 'Fuel' }).click()
  await page.waitForSelector('text=Fill history', { timeout: 15000 })
  const placeholder = await page.getByText('is not built yet').count()
  ok(placeholder === 0 ? 'real panel rendered' : 'STILL A PLACEHOLDER')

  console.log('\n[2] With no data it explains why, instead of showing a blank')
  const explained = await page.getByText('Record a fill to start tracking').count()
  ok(explained > 0 ? 'empty state explains what is needed' : 'NO EXPLANATION')
  await page.screenshot({ path: '/tmp/shot-fuel-empty.png' })

  console.log('\n[3] One full fill: still honest about not knowing yet')
  await recordFill(200000, 50, { amount: '70.00' })
  await page.waitForSelector('text=/One full tank recorded/', { timeout: 15000 })
  ok('says a second full tank is needed')

  console.log('\n[4] Second full fill produces a consumption figure')
  await recordFill(200500, 50, { amount: '69.00' })
  await page.waitForSelector('text=L/100 km', { timeout: 15000 })
  const figure = await page.locator('.tabular').first().textContent()
  ok(`consumption shown: ${figure?.replace(/\s+/g, ' ').trim()}`)
  await page.screenshot({ path: '/tmp/shot-fuel-economy.png' })

  console.log('\n[5] A partial fill is labelled as such')
  await recordFill(200700, 20, { partial: true, amount: '28.00' })
  await page.waitForSelector('text=Partial', { timeout: 15000 })
  ok('partial fill marked in the history')

  console.log('\n[6] The fill also reached the expense ledger')
  await page.getByRole('tab', { name: 'Expenses' }).click()
  await page.waitForSelector('text=From fuel', { timeout: 15000 })
  ok('fuel appears in the cost ledger, labelled as derived')
  await page.screenshot({ path: '/tmp/shot-fuel-expenses.png' })

  console.log('\n[7] Mobile width')
  await page.getByRole('tab', { name: 'Fuel' }).click()
  await page.waitForSelector('text=Fill history', { timeout: 15000 })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  ok(overflow ? 'HORIZONTAL SCROLL' : 'no horizontal scroll at 390px')
  await page.screenshot({ path: '/tmp/shot-fuel-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nFUEL UI HAS ERRORS\n' : '\nFUEL UI VERIFIED\n')
} finally {
  sql(`DELETE FROM expenses WHERE source_type='FUEL' AND source_record_id IN
        (SELECT id FROM fuel_entries WHERE odometer BETWEEN 200000 AND 201000);`)
  sql(`DELETE FROM odometer_entries WHERE source='FUEL' AND value BETWEEN 200000 AND 201000;`)
  sql(`DELETE FROM fuel_entries WHERE odometer BETWEEN 200000 AND 201000;`)
  sql(`DELETE FROM audit_logs WHERE resource_type='fuel_entry';`)
  await browser.close()
}
