/** Deterministic presentation checks. API fixtures do not verify backend behaviour. */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const origin = process.env.DASH_URL ?? 'http://localhost:3101'
const workspace = {
  id: 'visual-workspace',
  name: 'Personal Garage',
  role: 'OWNER',
  type: 'PERSONAL',
  defaultCurrency: 'GBP',
  defaultDistanceUnit: 'MILES',
}
const vehicle = {
  id: 'visual-vehicle',
  manufacturer: 'Example',
  model: 'Tourer',
  trim: 'Estate',
  modelYear: 2024,
  registrationNumber: 'DEMO',
  status: 'ACTIVE',
  currentOdometer: 24500,
  currentOdometerUnit: 'MILES',
  currentOdometerAt: '2026-09-20',
  distanceUnit: 'MILES',
  maintenanceStatus: 'UNKNOWN',
  inspectionStatus: 'UNKNOWN',
  nextService: null,
}
const dashboard = {
  counts: { vehicles: 1, totalVehicles: 1, attention: 0, servicesDue: 0, overdue: 0 },
  attention: [],
  recentActivity: [],
  costs: { thisMonth: null, currency: 'GBP' },
}
let scenario = 'populated'
const context = await browser.newContext()
await context.route('**/api/v1/**', async (route) => {
  const path = new URL(route.request().url()).pathname
  let data
  if (path.endsWith('/auth/session'))
    data = {
      user: {
        id: 'visual-user',
        displayName: 'Example User',
        email: 'visual@example.com',
        emailVerified: true,
      },
      workspaces: [
        {
          ...workspace,
          role: scenario === 'viewer' || scenario === 'driver' ? scenario.toUpperCase() : 'OWNER',
        },
        { ...workspace, id: 'second-workspace', name: 'Shared Garage', role: 'VIEWER' },
      ],
    }
  else if (path.endsWith('/dashboard')) {
    if (scenario === 'error')
      return route.fulfill({
        status: 500,
        json: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Temporary failure',
            requestId: 'visual-check',
          },
        },
      })
    if (scenario === 'loading') await new Promise((resolve) => setTimeout(resolve, 1500))
    data =
      scenario === 'empty'
        ? { ...dashboard, counts: { ...dashboard.counts, vehicles: 0, totalVehicles: 0 } }
        : dashboard
  } else if (path.endsWith('/vehicles'))
    data =
      scenario === 'empty'
        ? []
        : [{ ...vehicle, model: path.includes('second-workspace') ? 'Roadster' : vehicle.model }]
  else data = []
  await route.fulfill({ json: { data } })
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme })
    for (const width of [360, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Garage overview' }).waitFor()
      await page.getByRole('heading', { name: 'Example Tourer' }).waitFor()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${theme}/${width}: horizontal overflow`,
      )
      assert.equal(await page.getByRole('combobox', { name: 'Workspace' }).isVisible(), true)
      await page.screenshot({
        path: `/tmp/autoservices-redesign-${theme}-${width}.png`,
        fullPage: true,
      })
      console.log(`PASS ${theme} ${width}px: overview, vehicle, workspace, no overflow`)
    }
  }
  await page.keyboard.press('Tab')
  assert.equal(
    await page
      .getByRole('link', { name: 'Skip to content' })
      .evaluate((el) => el === document.activeElement),
    true,
  )
  await page.keyboard.press('Enter')
  assert.equal(await page.locator('main').evaluate((el) => el === document.activeElement), true)
  await page.getByRole('link', { name: 'View all vehicles' }).click()
  assert.equal(new URL(page.url()).pathname, '/vehicles')
  console.log('PASS keyboard skip link and vehicle navigation')
  scenario = 'empty'
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Make room for your first vehicle' }).waitFor()
  await page.getByRole('link', { name: 'Add your first vehicle' }).click()
  assert.equal(new URL(page.url()).pathname, '/vehicles/new')
  console.log('PASS empty state and add-vehicle navigation')
  scenario = 'error'
  await page.goto(origin)
  await page
    .getByText('Could not load your garage overview. Please try again.')
    .waitFor({ timeout: 15000 })
  assert.equal(await page.getByText('Services due', { exact: true }).count(), 0)
  scenario = 'populated'
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.getByText('Services due', { exact: true }).waitFor()
  console.log('PASS error state, no permanent loading, retry recovery')
  scenario = 'loading'
  await page.goto(origin)
  await page.getByRole('heading', { name: 'Garage overview' }).waitFor()
  assert.ok((await page.locator('main .animate-pulse').count()) > 0)
  await page.getByText('Services due', { exact: true }).waitFor()
  await page.getByText('Nothing needs your attention right now.').waitFor()
  for (const role of ['viewer', 'driver']) {
    scenario = role
    await page.goto(origin)
    await page.getByRole('heading', { name: 'Example Tourer' }).waitFor()
    assert.equal(await page.locator('a[href="/vehicles/new"]').count(), 0)
    await page.getByRole('link', { name: 'View all vehicles' }).click()
    await page.getByRole('heading', { name: 'Vehicles', exact: true }).waitFor()
    assert.equal(await page.locator('a[href="/vehicles/new"]').count(), 0)
  }
  console.log('PASS VIEWER/DRIVER: no vehicle-create entry points in shell, overview or list')
  scenario = 'populated'
  await page.goto(origin)
  const selector = page.getByRole('combobox', { name: 'Workspace' })
  await selector.selectOption('second-workspace')
  await page.getByRole('heading', { name: 'Example Roadster' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Example Tourer' }).count(), 0)
  assert.equal(await page.locator('a[href="/vehicles/new"]').count(), 0)
  await page.reload()
  await page.getByRole('heading', { name: 'Example Roadster' }).waitFor()
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable')
    }
  })
  await selector.selectOption('visual-workspace')
  await page.getByRole('heading', { name: 'Example Tourer' }).waitFor()
  console.log('PASS workspace-specific data, role changes, persistence and blocked storage')
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const more = page.getByRole('button', { name: 'More', exact: true })
    await more.click()
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true })
    await drawer.waitFor()
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab')
      // Native dialogs may give focus to browser chrome at the tab boundary;
      // no background page control may receive focus, and Tab must return inside.
      if (await page.evaluate(() => document.activeElement === document.body)) {
        await page.keyboard.press('Tab')
      }
      assert.equal(await drawer.evaluate((el) => el.contains(document.activeElement)), true)
    }
    await page.keyboard.press('Escape')
    assert.equal(await drawer.isVisible(), false)
    assert.equal(await more.evaluate((el) => el === document.activeElement), true)
    await more.click()
    await drawer.getByRole('link', { name: 'Vehicles', exact: true }).click()
    await page.getByRole('heading', { name: 'Vehicles', exact: true }).waitFor()
    assert.equal(await drawer.isVisible(), false)
    const account = page.getByRole('button', { name: 'Account', exact: true })
    await account.click()
    await page.getByRole('dialog', { name: 'Account', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await account.evaluate((el) => el === document.activeElement), true)
  }
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('dialog', { name: 'Navigation', exact: true }).waitFor({ state: 'hidden' })
  console.log('PASS drawer focus trap, Escape, focus restoration, navigation and desktop resize')
  assert.deepEqual(errors, [])
  console.log('PASS loading state; no page errors')
} finally {
  await browser.close()
}
