import type { Job } from 'bullmq'
import {
  suppressionBlocks,
  type EmailService,
  type NotificationCategory,
} from '@autoservices/email'
import { isTerminalSuccess, type EmailLog, type EmailSuppressionStore } from '@autoservices/db'
import type { Logger } from 'pino'

export interface JobContext {
  email: EmailService
  emailLog: EmailLog
  suppressions: EmailSuppressionStore
  logger: Logger
}

/**
 * Heartbeat: proves the scheduler is alive and that repeatable jobs actually fire.
 * A silently dead scheduler produces no errors and no emails, and users discover it by
 * missing an MOT — so its liveness is monitored actively (DEPLOYMENT.md §8).
 */
export async function handleHeartbeat(job: Job, ctx: JobContext): Promise<{ ok: true }> {
  ctx.logger.info({ jobId: job.id, queue: job.queueName }, 'scheduler heartbeat')
  return { ok: true }
}

export interface SendEmailJobData {
  template: string
  to: string
  props: Record<string, unknown>
  category: string
  idempotencyKey: string
  correlationId?: string
  userId?: string
  workspaceId?: string
}

export async function handleSendEmail(
  job: Job<SendEmailJobData>,
  ctx: JobContext,
): Promise<{ providerMessageId: string | null; skipped?: string }> {
  const { template, to, props, category, idempotencyKey, correlationId, userId, workspaceId } =
    job.data

  // Render first so the subject is known, then record BEFORE the provider call. If the
  // provider is down, support can still see that the message existed and why it failed
  // (EMAILS.md §5).
  const rendered = ctx.email.render({ template: template as never, props, to })

  const {
    id: messageId,
    isNew,
    status: existingStatus,
  } = await ctx.emailLog.record({
    idempotencyKey,
    template,
    recipientEmail: rendered.to,
    subject: rendered.subject,
    provider: ctx.email.transportName,
    userId: userId ?? null,
    workspaceId: workspaceId ?? null,
    correlationId: correlationId ?? null,
  })

  // Skip only if the message already reached the recipient. A previously FAILED or
  // stuck SENDING record must be retryable, or one transient provider blip would drop
  // the message permanently.
  if (!isNew && isTerminalSuccess(existingStatus)) {
    ctx.logger.info(
      { jobId: job.id, template, messageId, existingStatus },
      'email already delivered, skipping',
    )
    return { providerMessageId: null, skipped: 'DUPLICATE' }
  }

  if (!isNew) {
    ctx.logger.warn(
      { jobId: job.id, template, messageId, existingStatus },
      'retrying a previously unsuccessful email',
    )
  }

  // Refuse addresses we already know are bad. Checked here, before the provider call,
  // because continuing to mail a dead or complaining address is what gets a sending
  // domain blocked for every other user (EMAILS.md §7).
  const suppression = await ctx.suppressions.isSuppressed(rendered.to)
  if (suppression && suppressionBlocks(suppression.reason, category as NotificationCategory)) {
    await ctx.emailLog.advance(messageId, 'SUPPRESSED')
    ctx.logger.warn(
      { jobId: job.id, template, messageId, reason: suppression.reason },
      'recipient is suppressed, not sending',
    )
    return { providerMessageId: null, skipped: 'SUPPRESSED' }
  }

  await ctx.emailLog.markSending(messageId)

  try {
    const result = await ctx.email.send({
      template: template as never,
      to,
      props,
      category: category as never,
      idempotencyKey,
      correlationId,
    })

    if (result.skipped) {
      // DUPLICATE means the in-process/Redis ledger already sent this message, so the
      // recipient HAS it; SUPPRESSED/OPTED_OUT mean it was deliberately not delivered.
      // Recording both as SUPPRESSED would misreport a delivered message as blocked.
      await ctx.emailLog.advance(messageId, result.skipped === 'DUPLICATE' ? 'SENT' : 'SUPPRESSED')
      ctx.logger.info(
        { jobId: job.id, template, messageId, skipped: result.skipped },
        'email not dispatched',
      )
      return { providerMessageId: null, skipped: result.skipped }
    }

    await ctx.emailLog.markSent(messageId, result.providerMessageId)
    ctx.logger.info(
      { jobId: job.id, template, transport: result.transport, messageId, correlationId },
      'email sent',
    )
    return { providerMessageId: result.providerMessageId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await ctx.emailLog.markFailed(messageId, message)
    ctx.logger.error({ jobId: job.id, template, messageId, err: message }, 'email send failed')
    // Rethrow so BullMQ retries with backoff.
    throw err
  }
}

/**
 * Reminder sweep. Calls the API's internal scan endpoint rather than reaching into the
 * database directly, so the engine has exactly one implementation and the worker does
 * not need its own copy of the domain logic.
 *
 * Idempotent by construction: the scan reserves each delivery before sending, so a retry
 * produces no duplicate notifications or emails.
 */
export async function handleScanReminders(
  job: Job,
  ctx: JobContext,
): Promise<Record<string, number>> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4100'
  const token = process.env.SESSION_SECRET ?? ''

  const res = await fetch(`${apiUrl}/api/v1/internal/reminders/scan`, {
    method: 'POST',
    headers: { 'x-internal-token': token },
  })

  if (!res.ok) {
    // Throwing lets BullMQ retry with backoff. A silently failing sweep produces no
    // errors and no emails, and users discover it by missing an MOT.
    throw new Error(`reminder scan failed: ${res.status} ${await res.text()}`)
  }

  const body = (await res.json()) as { data: Record<string, number> }
  ctx.logger.info({ jobId: job.id, ...body.data }, 'reminder scan complete')
  return body.data
}
