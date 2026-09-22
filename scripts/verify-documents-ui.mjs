/** Drives the document vault (DOC-107) in a real browser, with a real file upload. */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  if (expectRejection && (t.includes('422') || t.includes('Failed to load resource'))) return
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

const dir = mkdtempSync(join(tmpdir(), 'as-docs-'))
const pdfPath = join(dir, 'ui-test-invoice.pdf')
writeFileSync(pdfPath, '%PDF-1.7\nUI verification document\n%%EOF\n')
const fakePath = join(dir, 'ui-test-fake.pdf')
writeFileSync(fakePath, '<html><script>alert(1)</script></html>')

try {
  console.log('\n[1] Sign in and open the Documents tab')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  await page
    .getByRole('link', { name: /Ford Mondeo/ })
    .first()
    .click()
  await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
  await page.getByRole('tab', { name: 'Documents' }).click()
  await page.waitForSelector('text=No documents yet', { timeout: 15000 })
  const placeholder = await page.getByText('is not built yet').count()
  check(placeholder === 0, 'real vault, not a placeholder', 'STILL A PLACEHOLDER')
  await page.screenshot({ path: '/tmp/shot-documents-empty.png' })

  console.log('\n[2] Upload a document through the browser')
  await page.setInputFiles('input[type="file"]', pdfPath)
  await page.waitForSelector('text=ui-test-invoice.pdf', { timeout: 30000 })
  ok('file uploaded straight to storage and listed')
  await page.screenshot({ path: '/tmp/shot-documents-filled.png' })

  console.log('\n[3] The row shows type and size, not the storage key')
  const row = page.locator('li', { hasText: 'ui-test-invoice.pdf' }).first()
  const text = (await row.textContent()) ?? ''
  !text.includes('workspaces/')
    ? ok(`row reads "${text.replace(/\s+/g, ' ').trim().slice(0, 70)}"`)
    : errs.push('storage key leaked into the UI')

  console.log('\n[4] Opening mints a fresh short-lived link')
  // The link is a Content-Disposition: attachment download, so the popup never navigates
  // anywhere to read a URL from. What matters is the link the API minted, so assert on
  // that response instead.
  const [download] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/download') && r.request().method() === 'GET', {
      timeout: 20000,
    }),
    row.getByRole('button', { name: 'Open' }).click(),
  ])
  const minted = (await download.json()).data
  minted.url.includes('X-Amz-Signature') &&
  minted.url.includes('X-Amz-Expires') &&
  minted.expiresInSeconds === 300
    ? ok(`presigned link minted on click, valid ${minted.expiresInSeconds}s`)
    : errs.push(`unsigned or unexpected download URL: ${String(minted.url).slice(0, 80)}`)

  console.log('\n[5] A file that is not what it claims is refused, visibly')
  expectRejection = true
  await page.setInputFiles('input[type="file"]', fakePath)
  await page.waitForSelector('[role="alert"]', { timeout: 30000 })
  const alert = (await page.locator('[role="alert"]').first().textContent()) ?? ''
  expectRejection = false
  const explained = /quarantin|does not match/i.test(alert)
  explained
    ? ok(`user told plainly: "${alert.trim().slice(0, 70)}"`)
    : errs.push(`unclear rejection message: ${alert}`)

  console.log('\n[6] Delete removes it from the list')
  await page
    .locator('li', { hasText: 'ui-test-invoice.pdf' })
    .first()
    .getByRole('button', { name: 'Delete' })
    .click()
  await page.waitForSelector('text=No documents yet', { timeout: 20000 })
  ok('document removed from the vault')

  console.log('\n[7] Mobile width: no horizontal scroll')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  check(!overflow, 'no horizontal scroll at 390px', 'HORIZONTAL SCROLL PRESENT')
  await page.screenshot({ path: '/tmp/shot-documents-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nDOCUMENTS UI HAS ERRORS\n' : '\nDOCUMENTS UI VERIFIED\n')
} finally {
  sql(`DELETE FROM audit_logs WHERE resource_type = 'document';`)
  sql(`DELETE FROM documents WHERE original_filename LIKE 'ui-test-%';`)
  await browser.close()
}
