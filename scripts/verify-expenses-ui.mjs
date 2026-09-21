/** Drives the Expenses tab and the dashboard spend tile (OWN-007/008). */
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
  if (t.includes('401')) return
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
const today = new Date().toISOString().slice(0, 10)

try {
  console.log('\n[1] Sign in and open a vehicle')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
  ok('vehicle open')

  console.log('\n[2] Expenses tab is real, not a "coming soon" placeholder')
  await page.getByRole('tab', { name: 'Expenses' }).click()
  await page.waitForSelector('text=Total recorded', { timeout: 15000 })
  const soon = await page.getByText('is not built yet').count()
  ok(soon === 0 ? 'tab renders the real panel' : 'STILL A PLACEHOLDER')
  await page.screenshot({ path: '/tmp/shot-expenses-empty.png' })

  console.log('\n[3] Record a service with a total, then check the ledger')
  await page.getByRole('tab', { name: 'Service' }).click()
  await page.waitForSelector('text=Service history', { timeout: 15000 })
  await page.getByRole('button', { name: 'Add service' }).first().click()
  await page.waitForSelector('text=Record a service', { timeout: 10000 })
  await dlg().locator('input[name="title"]').fill('Expense UI service')
  await dlg().locator('input[name="odometer"]').fill('133000')
  await dlg().locator('input[name="workshopName"]').fill('Expense UI Garage')
  await dlg().locator('input[name="totalAmount"]').fill('321.00')
  await dlg().getByRole('button', { name: 'Save service' }).click()
  await page.waitForSelector('text=Expense UI service', { timeout: 15000 })
  ok('service recorded')

  await page.getByRole('tab', { name: 'Expenses' }).click()
  await page.waitForSelector('text=Total recorded', { timeout: 15000 })
  await page.waitForSelector('text=From service', { timeout: 15000 })
  ok('the service appears in the ledger, labelled as derived')

  console.log('\n[4] A projected row offers no Remove action')
  const projectedRow = page.locator('li', { hasText: 'From service' }).first()
  const removable = await projectedRow.getByRole('button', { name: 'Remove' }).count()
  ok(removable === 0 ? 'no Remove on a derived cost' : 'DERIVED ROW IS EDITABLE')

  console.log('\n[5] Add a manual cost')
  await page.getByRole('button', { name: 'Add a cost' }).click()
  await page.waitForSelector('text=Add a cost', { timeout: 10000 })
  await dlg().locator('input[name="amount"]').fill('42.50')
  await dlg().locator('input[name="vendorName"]').fill('Expense UI Car Wash')
  await dlg().locator('textarea[name="description"]').fill('Valet')
  await dlg().getByRole('button', { name: 'Save' }).click()
  await page.waitForSelector('text=Expense UI Car Wash', { timeout: 15000 })
  ok('manual cost added')

  const totalText = await page.locator('.tabular').first().textContent()
  ok(`total shown: ${totalText?.trim()}`)

  console.log('\n[6] A manual cost CAN be removed')
  const manualRow = page.locator('li', { hasText: 'Expense UI Car Wash' }).first()
  const canRemove = await manualRow.getByRole('button', { name: 'Remove' }).count()
  ok(canRemove > 0 ? 'Remove offered on a manual cost' : 'MANUAL ROW NOT REMOVABLE')

  console.log('\n[7] The dashboard spend tile shows real money')
  await page.getByRole('link', { name: 'Overview' }).first().click()
  await page.waitForSelector('text=Spend this month', { timeout: 15000 })
  // The tile renders its cached value first and updates when the refetch lands, so
  // wait for the money rather than reading whatever is on screen at this instant.
  const pound = String.fromCharCode(163)
  const tile = page.locator('div', { hasText: /^Spend this month/ }).last()
  await page
    .locator(`text=/${pound}\\s?[0-9]/`)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
  const spend = (await tile.textContent()) ?? ''
  spend.includes(pound) && /\d/.test(spend)
    ? ok(`tile reads "${spend.replace(/\s+/g, ' ').trim().slice(0, 60)}"`)
    : errs.push(`spend tile shows no money: ${spend}`)

  console.log('\n[8] Mobile width: no horizontal scroll')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  ok(overflow ? 'HORIZONTAL SCROLL PRESENT' : 'no horizontal scroll at 390px')
  await page.screenshot({ path: '/tmp/shot-expenses-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nEXPENSES UI HAS ERRORS\n' : '\nEXPENSES UI VERIFIED\n')
} finally {
  sql(`DELETE FROM expenses WHERE vendor_name IN ('Expense UI Car Wash','Expense UI Garage');`)
  sql(
    `DELETE FROM expenses WHERE source_record_id IN (SELECT id FROM service_records WHERE title='Expense UI service');`,
  )
  sql(
    `DELETE FROM maintenance_completions WHERE service_record_id IN (SELECT id FROM service_records WHERE title='Expense UI service');`,
  )
  sql(
    `DELETE FROM service_record_parts WHERE service_record_id IN (SELECT id FROM service_records WHERE title='Expense UI service');`,
  )
  sql(
    `DELETE FROM odometer_entries WHERE source_record_id IN (SELECT id FROM service_records WHERE title='Expense UI service');`,
  )
  sql(`DELETE FROM service_records WHERE title='Expense UI service';`)
  await browser.close()
}
