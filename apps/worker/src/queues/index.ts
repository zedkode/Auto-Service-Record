import { Queue, type JobsOptions } from 'bullmq'
import type { Redis } from 'ioredis'

/**
 * Queue definitions (ARCHITECTURE.md §12).
 *
 * Every job must be idempotent. BullMQ retries, worker crashes and duplicate scheduler
 * runs must all be safe — which is why deliveries are keyed (EMAILS.md §4).
 */
export const QUEUE_NAMES = {
  notifications: 'notifications',
  emails: 'emails',
  maintenance: 'maintenance',
  documents: 'documents',
  reports: 'reports',
  cleanup: 'cleanup',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  notifications: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
  emails: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
  maintenance: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
  documents: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
  reports: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
  cleanup: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 300_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  },
}

export function createQueues(connection: Redis): Record<QueueName, Queue> {
  const entries = Object.values(QUEUE_NAMES).map((name) => [
    name,
    new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] }),
  ])
  return Object.fromEntries(entries) as Record<QueueName, Queue>
}
