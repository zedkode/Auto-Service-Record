/**
 * Proves the asynchronous pipeline end to end:
 *   enqueue -> Redis -> worker -> EmailService -> SMTP transport -> Mailpit
 * and that a duplicate idempotency key does NOT produce a second email.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true })

const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 58025}`
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
const queue = new Queue('emails', { connection })

const before = await (await fetch(`${MAILPIT}/api/v1/messages?limit=1`)).json()
console.log(`Mailpit messages before: ${before.messages_count}`)

const key = `verify-${Date.now()}`
const payload = {
  template: 'service-due',
  to: 'andrei@autoservices.local',
  category: 'MAINTENANCE',
  idempotencyKey: key,
  props: {
    vehicleName: 'Ford Mondeo',
    registration: 'AB16 CDE',
    itemName: 'Oil service',
    dueIn: '620 miles',
    currentOdometer: '131,260 mi',
    url: 'http://localhost:3101/vehicles',
  },
}

console.log('\nEnqueuing 3 jobs: 1 unique + 2 with the SAME idempotency key')
await queue.add('send-email', payload)
await queue.add('send-email', payload)
await queue.add('send-email', {
  ...payload,
  idempotencyKey: `${key}-other`,
  props: { ...payload.props, itemName: 'Brake fluid' },
})

await new Promise((r) => setTimeout(r, 6000))

const after = await (await fetch(`${MAILPIT}/api/v1/messages?limit=10`)).json()
const delivered = after.messages_count - before.messages_count
console.log(`Mailpit messages after:  ${after.messages_count}  (delivered: ${delivered})`)
console.log(
  delivered === 2
    ? '  ✓ idempotency held: 3 jobs -> 2 emails (duplicate key suppressed)'
    : `  ✗ expected 2 delivered, got ${delivered}`,
)

console.log('\nSubjects received:')
for (const m of after.messages.slice(0, 3)) {
  console.log(`  - ${m.Subject}  ->  ${m.To.map((t) => t.Address).join(', ')}`)
}

const counts = await queue.getJobCounts('completed', 'failed', 'active', 'waiting')
console.log('\nQueue "emails" job counts:', counts)

await queue.close()
connection.disconnect()
