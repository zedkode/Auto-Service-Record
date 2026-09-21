/**
 * End-to-end auth verification against the running stack:
 * register -> verification email in Mailpit -> verify -> forgot -> reset -> login.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'),
  quiet: true,
})

const API = 'http://localhost:4100/api/v1'
const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 58025}`
const email = `authtest-${Date.now()}@example.com`
const ok = (s) => console.log(`  ✓ ${s}`)

// Clear rate-limit counters so a re-run starts clean. The limiter itself is asserted
// explicitly in step 12.
async function clearRateLimits() {
  const { Redis } = await import('ioredis')
  const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  const keys = await r.keys('rl:*')
  if (keys.length) await r.del(...keys)
  r.disconnect()
  return keys.length
}
console.log(`Cleared ${await clearRateLimits()} rate-limit keys`)

const post = (p, body, cookie) =>
  fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })

async function waitForMail(subjectMatch, timeoutMs = 12000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const r = await (await fetch(`${MAILPIT}/api/v1/messages?limit=30`)).json()
    const m = r.messages?.find(
      (x) => x.To?.some((t) => t.Address === email) && x.Subject.includes(subjectMatch),
    )
    if (m) return m
    await new Promise((r) => setTimeout(r, 600))
  }
  throw new Error(`No email matching "${subjectMatch}" for ${email} within ${timeoutMs}ms`)
}

const linkFrom = (text, route) => {
  const marker = `/${route}?token=`
  const i = text.indexOf(marker)
  if (i === -1) throw new Error(`No ${route} link found in email body`)
  const token = text.slice(i + marker.length).split(/\s/)[0]
  if (!token) throw new Error(`Empty token in ${route} link`)
  return decodeURIComponent(token)
}

console.log('\n[1] Register (with confirmation + terms)')
let res = await post('/auth/register', {
  email,
  password: 'a-properly-long-password',
  passwordConfirmation: 'a-properly-long-password',
  displayName: 'Auth Test',
  acceptTerms: true,
})
if (res.status !== 201) throw new Error(`register ${res.status}: ${await res.text()}`)
ok('registered (201)')

console.log('\n[2] Registration rejects mismatched password / missing terms')
const bad1 = await post('/auth/register', {
  email: `x-${Date.now()}@example.com`,
  password: 'a-properly-long-password',
  passwordConfirmation: 'different-password',
  displayName: 'X',
  acceptTerms: true,
})
ok(`password mismatch -> ${bad1.status} ${(await bad1.json()).error.code}`)
const bad2 = await post('/auth/register', {
  email: `y-${Date.now()}@example.com`,
  password: 'a-properly-long-password',
  passwordConfirmation: 'a-properly-long-password',
  displayName: 'Y',
  acceptTerms: false,
})
ok(`terms not accepted -> ${bad2.status} ${(await bad2.json()).error.code}`)

console.log('\n[3] Verification email delivered via worker -> Mailpit')
const verifyMail = await waitForMail('Confirm your email')
const body = await (await fetch(`${MAILPIT}/api/v1/message/${verifyMail.ID}`)).json()
ok(`subject: "${verifyMail.Subject}"`)
const verifyToken = linkFrom(body.Text, 'verify-email')
ok(`token extracted (${verifyToken.slice(0, 12)}…)`)

console.log('\n[4] Verify email')
res = await post('/auth/verify-email', { token: verifyToken })
const vr = await res.json()
ok(`verify -> ${res.status} ${JSON.stringify(vr)}`)
if (res.status !== 200 || vr.data.alreadyVerified)
  throw new Error('expected a fresh verification with 200')

console.log('\n[5] Reused token is rejected')
res = await post('/auth/verify-email', { token: verifyToken })
ok(`replay -> ${res.status} ${(await res.json()).error.code}`)

console.log('\n[6] Welcome email sent on verification')
const welcome = await waitForMail('Welcome to AutoServices')
ok(`subject: "${welcome.Subject}"`)

console.log('\n[7] Forgot password (uniform response)')
res = await post('/auth/forgot-password', { email })
const known = await res.json()
const res2 = await post('/auth/forgot-password', { email: `nobody-${Date.now()}@example.com` })
const unknown = await res2.json()
ok(`known address   -> ${res.status} "${known.data.message}"`)
ok(`unknown address -> ${res2.status} "${unknown.data.message}"`)
if (JSON.stringify(known) !== JSON.stringify(unknown))
  throw new Error('ENUMERATION ORACLE: responses differ')
ok('responses identical — no account-enumeration oracle')

console.log('\n[8] Reset password')
const resetMail = await waitForMail('Reset your password')
const resetBody = await (await fetch(`${MAILPIT}/api/v1/message/${resetMail.ID}`)).json()
const resetToken = linkFrom(resetBody.Text, 'reset-password')
res = await post('/auth/reset-password', {
  token: resetToken,
  password: 'a-brand-new-password-1',
  passwordConfirmation: 'a-brand-new-password-1',
})
ok(`reset -> ${res.status}`)
if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)

console.log('\n[9] Old password rejected, new password works')
const oldLogin = await post('/auth/login', { email, password: 'a-properly-long-password' })
ok(`old password -> ${oldLogin.status} ${(await oldLogin.json()).error.code}`)
const newLogin = await post('/auth/login', { email, password: 'a-brand-new-password-1' })
ok(`new password -> ${newLogin.status}`)
if (newLogin.status !== 200) throw new Error('login with new password failed')

console.log('\n[10] Reset token cannot be replayed')
res = await post('/auth/reset-password', {
  token: resetToken,
  password: 'yet-another-password-1',
  passwordConfirmation: 'yet-another-password-1',
})
ok(`replay -> ${res.status} ${(await res.json()).error.code}`)

console.log('\n[11] Security alert email on password change')
await waitForMail('Your password was changed')
ok('password-changed notification delivered')

console.log('\n[12] Rate limiting actually fires')
await clearRateLimits()
const attempts = []
for (let i = 0; i < 7; i++) {
  const r = await post('/auth/login', { email, password: 'wrong-password-here' })
  attempts.push(r.status)
}
ok(`login attempts: ${attempts.join(', ')}`)
if (!attempts.includes(429)) throw new Error('rate limiter did NOT fire on repeated bad logins')
ok('429 returned after the configured threshold')
const limited = await post('/auth/login', { email, password: 'wrong' })
ok(`retry-after header: ${limited.headers.get('retry-after')}s`)
await clearRateLimits()

console.log('\nAUTH FLOW VERIFIED')
