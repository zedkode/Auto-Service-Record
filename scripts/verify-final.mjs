import { chromium } from 'playwright'
const D = 'http://localhost:3101'
const errs = []
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
page.on('pageerror', (e) => errs.push(e.message))

const ok = (s) => console.log(`  ✓ ${s}`)
const email = `newuser-${Date.now()}@example.com`

try {
  console.log('\n[A] Brand-new user registers with a real password')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create one' }).click()
  await page.waitForSelector('text=Create your account')
  await page.fill('input[name="displayName"]', 'Fresh User')
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', 'a-properly-long-password')
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=No vehicles yet', { timeout: 15000 })
  ok('registered; personal workspace auto-created; correct EMPTY state shown')

  console.log('\n[B] New user sees ONLY their own (zero) vehicles')
  // Exclude /vehicles/new — the add-vehicle links also match a naive prefix selector.
  const cards = await page.locator('a[href^="/vehicles/"]:not([href="/vehicles/new"])').count()
  ok(`real vehicle cards visible: ${cards} (must be 0)`)
  if (cards !== 0) throw new Error('CROSS-TENANT LEAK: new user can see other vehicles')

  // Authoritative check: ask the API directly with this user's session.
  const apiCount = await page.evaluate(async () => {
    const s = await (
      await fetch('http://localhost:4100/api/v1/auth/session', { credentials: 'include' })
    ).json()
    const ws = s.data.workspaces[0].id
    const v = await (
      await fetch(`http://localhost:4100/api/v1/workspaces/${ws}/vehicles`, {
        credentials: 'include',
      })
    ).json()
    return { workspace: ws, vehicles: v.data.length }
  })
  ok(`API reports ${apiCount.vehicles} vehicles for workspace ${apiCount.workspace.slice(0, 8)}…`)
  if (apiCount.vehicles !== 0) throw new Error('CROSS-TENANT LEAK at the API layer')

  console.log('\n[C] Add a vehicle as the new user')
  await page.getByRole('link', { name: 'Add your first vehicle' }).click()
  await page.waitForSelector('text=Add a vehicle')
  await page.fill('input[name="manufacturer"]', 'Skoda')
  await page.fill('input[name="model"]', 'Octavia')
  await page.fill('input[name="currentOdometer"]', '42000')
  await page.click('button[type="submit"]')
  await page.waitForSelector('h1:has-text("Skoda Octavia")', { timeout: 15000 })
  ok('vehicle created by a real registered user')

  console.log('\n[D] Client-side validation blocks a bad VIN before the request')
  await page.goto(`${D}/vehicles/new`, { waitUntil: 'networkidle' })
  await page.fill('input[name="manufacturer"]', 'Test')
  await page.fill('input[name="model"]', 'Test')
  await page.click('button:has-text("More details")')
  await page.fill('input[name="vin"]', 'IIIIIIIIIIIIIIIII')
  await page.click('button[type="submit"]')
  await page.waitForSelector('text=excludes I, O and Q', { timeout: 8000 })
  ok('shared Zod schema rejected the VIN with a helpful message')

  console.log('\n[E] Sign out')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.click('button[aria-label="Account menu"]')
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await page.waitForSelector('text=Sign in to AutoServices', { timeout: 10000 })
  ok('signed out; returned to sign-in')

  console.log(`\nPage errors: ${errs.length === 0 ? 'none' : errs.slice(0, 5).join(' | ')}`)
  console.log('\nFINAL VERIFICATION PASSED')
} catch (e) {
  console.error('\nFAILED:', e.message)
  await page.screenshot({ path: '/tmp/final-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
