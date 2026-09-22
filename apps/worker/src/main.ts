import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { createLogger } from '@autoservices/logger'
import { EmailService, createTransport, RedisIdempotencyStore } from '@autoservices/email'
import { EmailLog, EmailSuppressionStore } from '@autoservices/db'
import { PrismaClient } from '@prisma/client'
import { s3FromEnv } from '@autoservices/storage'
import { PrismaPg } from '@prisma/adapter-pg'
import { createQueues, QUEUE_NAMES, type QueueName } from './queues/index.js'
import {
  handleHeartbeat,
  handleSendEmail,
  handleScanReminders,
  type JobContext,
} from './jobs/handlers.js'
import { handleBuildExport } from './jobs/export.handler.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env'), quiet: true })

const logger = createLogger({
  name: 'worker',
  level: process.env.LOG_LEVEL ?? 'info',
  pretty: process.env.NODE_ENV !== 'production',
})

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) throw new Error('REDIS_URL is not set')

  // BullMQ requires this setting on its blocking connections.
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })

  connection.on('error', (err: Error) => logger.error({ err }, 'redis connection error'))

  // Redis-backed idempotency: SET NX is atomic, so duplicate deliveries are suppressed
  // across concurrent jobs, worker restarts AND multiple replicas — which an in-process
  // Set cannot do (EMAILS.md §4).
  const email = new EmailService({
    transport: createTransport(),
    fromName: process.env.MAIL_FROM_NAME ?? 'AutoServices',
    fromEmail: process.env.MAIL_FROM_EMAIL ?? 'notifications@autoservices.local',
    replyTo: process.env.MAIL_REPLY_TO,
    overrideRecipient: process.env.MAIL_OVERRIDE_RECIPIENT || undefined,
    idempotencyStore: new RedisIdempotencyStore(connection),
  })
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  const emailLog = new EmailLog(prisma)
  const suppressions = new EmailSuppressionStore(prisma)

  const ctx: JobContext = { email, emailLog, suppressions, logger }

  /**
   * Exports are written straight to object storage by the worker: there is no browser in
   * the loop to hand a presigned PUT to (EXP-001).
   */
  const storage = s3FromEnv()
  const exportCtx = { prisma: prisma as never, storage, logger }

  const queues = createQueues(connection)
  const workers: Worker[] = []

  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5)

  const dispatch = async (job: Job): Promise<unknown> => {
    switch (job.name) {
      case 'heartbeat':
        return handleHeartbeat(job, ctx)
      case 'send-email':
        return handleSendEmail(job as never, ctx)
      case 'scan-reminders':
        return handleScanReminders(job, ctx)
      case 'build-export':
        return handleBuildExport(job, exportCtx)
      default:
        // Unknown job names fail loudly rather than being silently discarded.
        throw new Error(`No handler registered for job "${job.name}"`)
    }
  }

  for (const name of Object.values(QUEUE_NAMES) as QueueName[]) {
    const worker = new Worker(name, dispatch, { connection, concurrency })

    worker.on('failed', (job, err) => {
      logger.error(
        {
          queue: name,
          jobId: job?.id,
          jobName: job?.name,
          attempts: job?.attemptsMade,
          err: err.message,
        },
        'job failed',
      )
    })
    worker.on('completed', (job) => {
      logger.debug({ queue: name, jobId: job.id, jobName: job.name }, 'job completed')
    })

    workers.push(worker)
  }

  // Repeatable schedulers are defined once, here, in the worker — never in the API,
  // where every replica would run them (ADR-004).
  await queues.notifications.upsertJobScheduler(
    'heartbeat-scheduler',
    { every: 60_000 },
    { name: 'heartbeat', data: {} },
  )
  // Hourly rather than daily: reminders are evaluated against local send windows, and
  // an hourly cadence spreads the work instead of creating a midnight spike
  // (ARCHITECTURE.md §12, DECISIONS.md D-008).
  await queues.notifications.upsertJobScheduler(
    'hourly-reminder-scan',
    { pattern: '7 * * * *' },
    { name: 'scan-reminders', data: {} },
  )

  logger.info(
    { queues: Object.values(QUEUE_NAMES), concurrency, mailTransport: email.transportName },
    'worker started',
  )

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down — finishing in-flight jobs')
    // close() lets the current job finish and stops accepting new work.
    await Promise.all(workers.map((w) => w.close()))
    await Promise.all(Object.values(queues).map((q) => q.close()))
    await prisma.$disconnect()
    connection.disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start')
  process.exit(1)
})
