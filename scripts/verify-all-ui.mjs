import { chromium } from 'playwright'
const errs = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const text = m.text()
  // 401 on the dashboard and 404 on the admin session probe are both the expected
  // "you are not signed in" answers, not faults.
  if (text.includes('401') || text.includes('404')) return
  errs.push(`console: ${text.slice(0, 120)}`)
})

const shots = []
async function capture(name, url, waitFor) {
  await page.goto(url, { waitUntil: 'networkidle' })
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 })
  const p = `/tmp/shot-${name}.png`
  await page.screenshot({ path: p, fullPage: false })
  shots.push(p)
  console.log(`  ✓ ${name.padEnd(12)} ${url}`)
}

console.log('Capturing applications:')
await capture('marketing', 'http://localhost:3100/', 'text=Know exactly what your')
await capture('pricing', 'http://localhost:3100/pricing', 'text=Start free')
// The admin console now sits behind the staff realm (ADMIN-001), so the unauthenticated
// view IS the sign-in screen. Capturing that is the honest check here; signing in is
// covered by verify-admin-ui.mjs.
await capture('admin', 'http://localhost:3102/', 'text=Operations console')

// Dashboard requires a session
await page.goto('http://localhost:3101/', { waitUntil: 'networkidle' })
await page.click('text=Sign in as andrei@autoservices.local')
await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
await page.screenshot({ path: '/tmp/shot-dashboard.png' })
shots.push('/tmp/shot-dashboard.png')
console.log('  ✓ dashboard    http://localhost:3101/ (authenticated)')

// Vehicle detail
await page.click('text=Ford Mondeo')
await page.waitForSelector('h1:has-text("Ford Mondeo")', { timeout: 15000 })
await page.screenshot({ path: '/tmp/shot-vehicle.png' })
shots.push('/tmp/shot-vehicle.png')
console.log('  ✓ vehicle      detail page')

await page.goto(page.url().split('?')[0] + '?tab=timeline', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Timeline', { timeout: 10000 })
await page.screenshot({ path: '/tmp/shot-timeline.png' })
shots.push('/tmp/shot-timeline.png')
console.log('  ✓ timeline     tab')

// Mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.goto('http://localhost:3101/', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Your vehicles', { timeout: 10000 })
const hScroll = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
)
await page.screenshot({ path: '/tmp/shot-mobile.png' })
shots.push('/tmp/shot-mobile.png')
console.log(`  ✓ mobile 390px  horizontal-scroll=${hScroll}`)

console.log(`\nErrors: ${errs.length === 0 ? 'none' : ''}`)
errs.slice(0, 8).forEach((e) => console.log('  ✗ ' + e))
await browser.close()
