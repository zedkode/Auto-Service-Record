import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

/**
 * Producer side of the job pipeline (ARCHITECTURE.md §12, ADR-004).
 *
 * The API enqueues and returns. It NEVER waits on a provider: an HTTP request that
 * blocks on a third-party email API is a request that fails when that API is slow.
 */
export type QueueName =
  | 'emails'
  | 'notifications'
  | 'maintenance'
  | 'documents'
  | 'reports'
  | 'cleanup'

export interface SendEmailJob {
  template: string
  to: string
  props: Record<string, unknown>
  category: string
  idempotencyKey: string
  correlationId?: string
  userId?: string
  workspaceId?: string
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger('QueueService')
  private readonly connection: Redis
  private readonly queues = new Map<QueueName, Queue>()

  constructor() {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not set')
    this.connection = new Redis(url, { maxRetriesPerRequest: null })
    this.connection.on('error', (err: Error) =>
      this.logger.error({ err: err.message }, 'redis connection error'),
    )
  }

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name)
    if (!q) {
      q = new Queue(name, { connection: this.connection })
      this.queues.set(name, q)
    }
    return q
  }

  /**
   * Enqueue an email. The deterministic jobId means a duplicate enqueue is absorbed by
   * BullMQ itself, before the worker's own idempotency reservation even runs.
   */
  async sendEmail(job: SendEmailJob): Promise<boolean> {
    try {
      await this.queue('emails').add('send-email', job, {
        // BullMQ rejects custom job ids containing ':' (it is their key separator), so
        // any colons in the idempotency key are normalised out. Without this the enqueue
        // throws and — because the catch below is deliberately non-fatal — the email is
        // silently never sent.
        jobId: `email-${job.idempotencyKey.replace(/:/g, '-')}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 },
      })
      return true
    } catch (err) {
      // Never fail the user's request because the queue is unavailable. A missed
      // verification email is recoverable via resend; a failed registration is not.
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          template: job.template,
          to: job.to,
          idempotencyKey: job.idempotencyKey,
        },
        'FAILED TO ENQUEUE EMAIL — caller must release its delivery reservation',
      )
      // Never fail the user's request because the queue is unavailable, but DO report
      // it, so the caller can release its reservation and let a later run retry.
      return false
    }
  }

  async enqueue(name: QueueName, jobName: string, data: unknown, jobId?: string): Promise<void> {
    try {
      const safeId = jobId?.replace(/:/g, '-')
      await this.queue(name).add(jobName, data, safeId ? { jobId: safeId } : undefined)
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), queue: name, jobName },
        'failed to enqueue job',
      )
    }
  }

  /** Queue depth, for the admin console. */
  async counts(name: QueueName) {
    return this.queue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
  }

  async healthy(): Promise<boolean> {
    try {
      return (await this.connection.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()))
    this.connection.disconnect()
  }
}
