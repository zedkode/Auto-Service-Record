import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import {
  verifyResendSignature,
  providerMessageIdOf,
  suppressionFromEvent,
  type ResendWebhookEvent,
  type WebhookHeaders,
} from '@autoservices/email'
import { EmailLog, EmailSuppressionStore, statusFromProviderEvent } from '@autoservices/db'
import { PrismaService } from '../../common/prisma.service.js'
import { Public } from '../../common/decorators/index.js'
import { Errors } from '../../common/errors.js'

/**
 * Resend delivery webhook (SEC-013, EMAILS.md §6).
 *
 * Unauthenticated by design and therefore signature-verified before the body is trusted.
 * Returns 2xx quickly so the provider does not retry an event we already have.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger('ResendWebhook')
  private readonly emailLog: EmailLog
  private readonly suppressions: EmailSuppressionStore

  constructor(private readonly prisma: PrismaService) {
    this.emailLog = new EmailLog(prisma.raw)
    this.suppressions = new EmailSuppressionStore(prisma.raw)
  }

  @Public()
  @HttpCode(200)
  @Post('resend')
  async resend(@Req() req: FastifyRequest, @Headers() headers: Record<string, string>) {
    const secret = process.env.RESEND_WEBHOOK_SECRET ?? ''

    // The RAW body is what was signed; a re-serialised object would not match.
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {})

    const verification = verifyResendSignature(raw, headers as WebhookHeaders, secret)
    if (!verification.ok) {
      this.logger.warn({ reason: verification.reason }, 'rejected webhook')
      await this.recordSystemEvent('webhook.rejected', verification.reason)
      // 401, not 404: the endpoint's existence is public knowledge (the provider is
      // configured with it), so hiding it buys nothing, and a clear status helps
      // whoever is debugging the integration.
      throw Errors.unauthenticated()
    }

    const event = (req.body ?? {}) as ResendWebhookEvent
    const eventId = headers['svix-id']
    if (!eventId || !event.type) {
      this.logger.warn('webhook missing an id or type')
      return { data: { processed: false, reason: 'malformed' } }
    }

    const providerMessageId = providerMessageIdOf(event)
    if (!providerMessageId) {
      return { data: { processed: false, reason: 'no_message_id' } }
    }

    const message = await this.emailLog.findByProviderMessageId(providerMessageId)
    if (!message) {
      // Usually a race between our send transaction and a fast webhook. Recorded rather
      // than discarded, so it is visible if it becomes a pattern.
      this.logger.warn({ providerMessageId, type: event.type }, 'webhook for an unknown message')
      await this.recordSystemEvent('webhook.orphan', `${event.type}:${providerMessageId}`)
      return { data: { processed: false, reason: 'unknown_message' } }
    }

    const appended = await this.emailLog.appendEvent({
      emailMessageId: message.id,
      providerEventId: eventId,
      eventType: event.type,
      occurredAt: event.created_at ? new Date(event.created_at) : new Date(),
      payload: event.data,
    })

    if (!appended) {
      // Replay of an event we already stored: idempotent no-op.
      return { data: { processed: false, reason: 'duplicate' } }
    }

    const nextStatus = statusFromProviderEvent(event.type)
    const advanced = nextStatus ? await this.emailLog.advance(message.id, nextStatus) : false

    // A permanent bounce or a complaint stops us writing to this address again. The
    // recipient is taken from OUR record rather than the webhook payload, which is
    // attacker-shaped data even after the signature checks out.
    const verdict = suppressionFromEvent(event)
    let suppressed = false
    if (verdict.suppress) {
      await this.suppressions.suppress({
        email: message.recipientEmail,
        reason: verdict.reason,
        detail: verdict.detail,
        sourceEventId: eventId,
        sourceMessageId: message.id,
      })
      suppressed = true
      this.logger.warn(
        { messageId: message.id, reason: verdict.reason },
        'address added to the suppression list',
      )
      await this.recordSystemEvent('email.suppressed', `${verdict.reason}: ${verdict.detail}`)
    }

    this.logger.log(
      { type: event.type, messageId: message.id, advanced, suppressed },
      'processed delivery event',
    )
    return { data: { processed: true, advanced, suppressed } }
  }

  private async recordSystemEvent(eventType: string, message: string): Promise<void> {
    try {
      await this.prisma.raw.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: eventType,
          resourceType: 'email_webhook',
          metadata: { message },
        },
      })
    } catch {
      // Never let audit failure break webhook handling.
    }
  }
}
