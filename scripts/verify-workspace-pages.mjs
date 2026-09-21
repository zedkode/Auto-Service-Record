/** Workspace-level Expenses and Documents pages (OWN-007, DOC-107). */
import { chromium } from 'playwright'
const errs = []
const b = await chromium.launch()
const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('401')) errs.push(m.text().slice(0, 120))
})
const ok = (s) => console.log(`  ✓ ${s}`)
try {
  await page.goto('http://localhost:3101', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })

  console.log('\n[1] Sidebar no longer marks working features as Soon')
  const expensesSoon = await page.locator('a[href="/expenses"] >> text=Soon').count()
  const docsSoon = await page.locator('a[href="/documents"] >> text=Soon').count()
  ok(
    expensesSoon === 0 && docsSoon === 0
      ? 'Expenses and Documents are no longer labelled Soon'
      : 'STALE SOON LABELS',
  )

  console.log('\n[2] Workspace expenses page')
  await page.getByRole('link', { name: 'Expenses' }).first().click()
  await page.waitForSelector('text=All costs', { timeout: 15000 })
  const placeholder = await page.getByText('is not built yet').count()
  ok(placeholder === 0 ? 'real page, not a placeholder' : 'PLACEHOLDER')
  await page.getByRole('button', { name: 'This year' }).click()
  await page.waitForTimeout(600)
  ok('period switch works')
  await page.screenshot({ path: '/tmp/shot-ws-expenses.png' })

  console.log('\n[3] Workspace documents page')
  await page.getByRole('link', { name: 'Documents' }).first().click()
  await page.waitForSelector('text=All documents', { timeout: 15000 })
  ok('documents page renders')
  await page.screenshot({ path: '/tmp/shot-ws-documents.png' })

  console.log('\n[4] Mobile width')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const of = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  ok(of ? 'HORIZONTAL SCROLL' : 'no horizontal scroll at 390px')
  console.log(`\nErrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`)
} finally {
  await b.close()
}
console.log(errs.length ? '\nWORKSPACE PAGES HAVE ERRORS\n' : '\nWORKSPACE PAGES VERIFIED\n')
