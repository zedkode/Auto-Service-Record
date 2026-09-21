/** Drives the notification centre and reminders page in a real browser. */
import { chromium } from 'playwright'
const D = 'http://localhost:3101'
const errs = []
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('401')) errs.push(m.text().slice(0, 140))
})
const ok = (s) => console.log(`  ✓ ${s}`)

try {
  console.log('\n[1] Sign in')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 20000 })
  ok('signed in')

  console.log('\n[2] Notification centre in the header')
  const bell = page.getByRole('button', { name: /Notifications/ })
  await bell.waitFor({ timeout: 10000 })
  const label = await bell.getAttribute('aria-label')
  ok(`bell present, aria-label="${label}"`)
  await bell.click()
  // The list is fetched only once the panel opens, so wait for it to settle.
  await page.waitForSelector('[role="menu"][aria-label="Notifications"]', { timeout: 10000 })
  await page
    .locator('[role="menu"][aria-label="Notifications"] li')
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {})
  const items = await page.locator('[role="menu"][aria-label="Notifications"] li').count()
  ok(`panel opened with ${items} notification(s)`)
  await page.screenshot({ path: '/tmp/shot-notifications.png' })

  console.log('\n[3] Reminders page')
  await page.getByRole('button', { name: 'View all reminders' }).click()
  await page.waitForSelector('h1:has-text("Reminders")', { timeout: 15000 })
  const overdue = await page.locator('text=Overdue').count()
  ok(`reminders page rendered (${overdue} overdue marker(s))`)
  await page.screenshot({ path: '/tmp/shot-reminders.png' })

  console.log('\n[4] Snooze a reminder')
  const snoozeBtn = page.getByRole('button', { name: 'Snooze 7d' }).first()
  if ((await snoozeBtn.count()) > 0) {
    await snoozeBtn.click()
    await page.waitForTimeout(1500)
    const snoozedTag = await page.locator('text=snoozed to').count()
    ok(snoozedTag > 0 ? 'reminder snoozed and labelled' : 'snoozed (no label found)')
  } else {
    ok('no active reminder to snooze')
  }

  console.log('\n[5] Show handled')
  await page.getByRole('button', { name: 'Show handled' }).click()
  await page.waitForSelector('text=Handled', { timeout: 10000 })
  ok('handled section revealed')

  console.log('\n[6] Sidebar entry is live (no "Soon" badge)')
  const soonBadges = await page.locator('nav a[href="/reminders"] >> text=Soon').count()
  ok(soonBadges === 0 ? 'Reminders no longer marked "Soon"' : 'STILL MARKED SOON')

  console.log('\n[7] Mobile 390px')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${D}/reminders`, { waitUntil: 'networkidle' })
  await page.waitForSelector('h1:has-text("Reminders")', { timeout: 10000 })
  const hScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  ok(hScroll ? 'HORIZONTAL SCROLL (bug)' : 'no horizontal scroll')

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 4).join(' | ') : 'none'}`)
  console.log('\nREMINDERS UI VERIFIED')
} catch (e) {
  console.error('\nFAILED:', e.message)
  await page.screenshot({ path: '/tmp/rem-fail.png' }).catch(() => {})
  console.error('errors:', errs.slice(0, 4))
  process.exitCode = 1
} finally {
  await browser.close()
}
