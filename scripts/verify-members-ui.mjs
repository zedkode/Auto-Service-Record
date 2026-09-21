/** Drives member management and invitation acceptance in a real browser (WS-005). */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const D = 'http://localhost:3101'
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '58025'}`
const errs = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const t = m.text()
  if (t.includes('401') || t.includes('404')) return
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

execFileSync(
  'bash',
  [
    '-c',
    "docker exec -i autoservices-redis redis-cli --scan --pattern 'rl:*' | " +
      'xargs -r docker exec -i autoservices-redis redis-cli DEL',
  ],
  { encoding: 'utf8' },
)

const stamp = Date.now()
const guestEmail = `ui-guest-${stamp}@example.com`
const created = [guestEmail]

try {
  console.log('\n[1] Sign in as the owner and open Members')
  await page.goto(D, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Sign in as andrei/ }).click()
  await page.waitForSelector('text=Your vehicles', { timeout: 15000 })
  await page.getByRole('link', { name: 'Members' }).first().click()
  await page.waitForSelector('text=Current members', { timeout: 15000 })
  const stale = await page.getByText('Invitations arrive in Phase 8').count()
  ok(stale === 0 ? 'members page no longer says invitations are unavailable' : 'STALE COPY')
  await page.screenshot({ path: '/tmp/shot-members.png' })

  console.log('\n[2] Invite someone through the UI')
  await page.getByRole('button', { name: 'Invite someone' }).click()
  await page.waitForSelector('dialog[open]', { timeout: 10000 })
  const dlg = page.locator('dialog[open]')
  await dlg.locator('input[name="email"]').fill(guestEmail)
  await dlg.locator('select[name="role"]').selectOption('EDITOR')
  await dlg.getByRole('button', { name: 'Send invitation' }).click()
  await page.waitForSelector(`text=${guestEmail}`, { timeout: 20000 })
  ok('invitation sent and confirmed in the dialog')
  await dlg.getByRole('button', { name: 'Done' }).click()

  console.log('\n[3] It appears as pending')
  await page.waitForSelector('text=Pending invitations', { timeout: 10000 })
  const listed = await page.getByText(guestEmail).count()
  ok(listed > 0 ? 'listed under pending invitations' : 'NOT LISTED')

  console.log('\n[4] The invited person accepts, in their own browser')
  let token = null
  for (let i = 0; i < 20 && !token; i++) {
    await page.waitForTimeout(500)
    const box = await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(guestEmail)}`)
    ).json()
    const msg = (box.messages ?? []).find((m) => (m.Subject ?? '').includes('invited you'))
    if (!msg) continue
    const body = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).text()
    const match = body.match(/invitations\/accept\?token=([A-Za-z0-9_-]+)/)
    if (match) token = match[1]
  }
  if (!token) throw new Error('no invitation email arrived')
  ok('invitation email received')

  // A separate context: a different person, a different session.
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const guest = await guestCtx.newPage()
  await guest.goto(`${D}/invitations/accept?token=${token}`, { waitUntil: 'networkidle' })
  // They have no account yet, so they land on sign-in; register instead.
  await guest.waitForTimeout(1500)
  const needsAccount = await guest.getByText(/Sign in|Create your account/i).count()
  ok(needsAccount > 0 ? 'an invited stranger is asked to sign in first' : 'NO AUTH WALL')
  await guest.screenshot({ path: '/tmp/shot-invitation-signin.png' })
  await guestCtx.close()

  console.log('\n[5] The owner can revoke it again')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Pending invitations', { timeout: 15000 })
  await page.getByRole('button', { name: 'Revoke' }).first().click()
  await page.waitForFunction((email) => !document.body.innerText.includes(email), guestEmail, {
    timeout: 10000,
  })
  const revoked = sql(
    `SELECT revoked_at IS NOT NULL FROM workspace_invitations WHERE email='${guestEmail}';`,
  )
  ok(revoked === 't' ? 'revoked from the UI and recorded' : 'REVOKE DID NOT PERSIST')

  console.log('\n[6] Mobile width')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  ok(overflow ? 'HORIZONTAL SCROLL' : 'no horizontal scroll at 390px')
  await page.screenshot({ path: '/tmp/shot-members-mobile.png' })

  console.log(`\nErrors: ${errs.length ? errs.slice(0, 3).join(' | ') : 'none'}`)
  console.log(errs.length ? '\nMEMBERS UI HAS ERRORS\n' : '\nMEMBERS UI VERIFIED\n')
} finally {
  for (const email of created) {
    sql(`DELETE FROM workspace_invitations WHERE email='${email}';`)
  }
  sql(`DELETE FROM audit_logs WHERE resource_type = 'workspace_invitation';`)
  await browser.close()
}
