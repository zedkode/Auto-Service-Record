/**
 * Email history (MAIL-004, EMAILS.md §5).
 *
 * Lives here rather than in an app because BOTH the API (which enqueues) and the worker
 * (which sends) need it, and apps may not import from each other. One implementation,
 * two consumers.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

export type EmailStatus =
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'DELAYED'
  | 'BOUNCED'
  | 'COMPLAINED'
  | 'FAILED'
  | 'SUPPRESSED'

/**
 * Status only moves forward. Providers deliver events out of order, so a late `sent`
 * webhook must not overwrite `delivered`. Negative terminal outcomes outrank delivery:
 * a message that bounced after an optimistic "delivered" is genuinely a failure.
 */
export const EMAIL_STATUS_RANK: Record<EmailStatus, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELAYED: 3,
  DELIVERED: 4,
  BOUNCED: 5,
  COMPLAINED: 6,
  FAILED: 7,
  SUPPRESSED: 8,
}

export interface RecordEmailInput {
  idempotencyKey: string
  template: string
  recipientEmail: string
  subject: string
  provider: string
  workspaceId?: string | null
  userId?: string | null
  correlationId?: string | null
  locale?: string
  metadata?: Record<string, unknown>
}

export class EmailLog {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates the record, or returns the existing one for this idempotency key.
   *
   * `status` is returned so the caller can distinguish "already delivered" (skip) from
   * "previously failed" (retry). Treating every existing record as a skip would make a
   * transient provider failure permanent.
   */
  async record(
    input: RecordEmailInput,
  ): Promise<{ id: string; isNew: boolean; status: EmailStatus }> {
    try {
      const created = await this.prisma.emailMessage.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          template: input.template,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          provider: input.provider,
          workspaceId: input.workspaceId ?? null,
          userId: input.userId ?? null,
          correlationId: input.correlationId ?? null,
          locale: input.locale ?? 'en-GB',
          status: 'QUEUED',
          metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      })
      return { id: created.id, isNew: true, status: 'QUEUED' }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.emailMessage.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        })
        if (existing) {
          return { id: existing.id, isNew: false, status: existing.status as EmailStatus }
        }
      }
      throw err
    }
  }

  async markSending(id: string): Promise<void> {
    await this.advance(id, 'SENDING')
  }

  async markSent(id: string, providerMessageId: string | null): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: { providerMessageId, sentAt: new Date(), lastEventAt: new Date() },
    })
    await this.advance(id, 'SENT')
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.emailMessage.update({
      where: { id },
      data: {
        failedAt: new Date(),
        lastEventAt: new Date(),
        metadata: { error: error.slice(0, 500) } as Prisma.InputJsonValue,
      },
    })
    await this.advance(id, 'FAILED')
  }

  /** Applies a status only if it ranks higher than the current one. */
  async advance(id: string, next: EmailStatus): Promise<boolean> {
    const current = await this.prisma.emailMessage.findUnique({
      where: { id },
      select: { status: true },
    })
    if (!current) return false
    if (EMAIL_STATUS_RANK[next] <= EMAIL_STATUS_RANK[current.status as EmailStatus]) {
      return false
    }
    await this.prisma.emailMessage.update({
      where: { id },
      data: {
        status: next,
        lastEventAt: new Date(),
        ...(next === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      },
    })
    return true
  }

  /** Operational inspection: recent messages with their most recent events. */
  async list(
    opts: { limit?: number; status?: string; recipient?: string; workspaceId?: string } = {},
  ) {
    const rows = await this.prisma.emailMessage.findMany({
      where: {
        ...(opts.status ? { status: opts.status as never } : {}),
        ...(opts.recipient
          ? { recipientEmail: { contains: opts.recipient, mode: 'insensitive' } }
          : {}),
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
      },
      include: { events: { orderBy: { occurredAt: 'desc' }, take: 10 } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    })

    return rows.map((m) => ({
      id: m.id,
      template: m.template,
      recipientEmail: m.recipientEmail,
      subject: m.subject,
      provider: m.provider,
      providerMessageId: m.providerMessageId,
      status: m.status,
      correlationId: m.correlationId,
      createdAt: m.createdAt.toISOString(),
      sentAt: m.sentAt?.toISOString() ?? null,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      failedAt: m.failedAt?.toISOString() ?? null,
      events: m.events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
      })),
    }))
  }

  async findByProviderMessageId(providerMessageId: string) {
    return this.prisma.emailMessage.findFirst({ where: { providerMessageId } })
  }

  /**
   * Appends a provider event. The unique providerEventId makes a replayed webhook an
   * idempotent no-op rather than a duplicated state transition.
   */
  async appendEvent(input: {
    emailMessageId: string
    providerEventId: string
    eventType: string
    occurredAt: Date
    payload?: unknown
  }): Promise<boolean> {
    try {
      await this.prisma.emailDeliveryEvent.create({
        data: {
          emailMessageId: input.emailMessageId,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          occurredAt: input.occurredAt,
          payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
        },
      })
      return true
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false
      }
      throw err
    }
  }
}

/** Maps a Resend event type onto our status vocabulary. */
export function statusFromProviderEvent(eventType: string): EmailStatus | null {
  switch (eventType) {
    case 'email.sent':
      return 'SENT'
    case 'email.delivered':
      return 'DELIVERED'
    case 'email.delivery_delayed':
      return 'DELAYED'
    case 'email.bounced':
      return 'BOUNCED'
    case 'email.complained':
      return 'COMPLAINED'
    case 'email.failed':
      return 'FAILED'
    // opened/clicked are engagement, not delivery state, so they are recorded as events
    // without moving the status.
    default:
      return null
  }
}

/**
 * Whether a message in this state has already reached the recipient (or definitively
 * will not). Anything else is safe — and necessary — to retry.
 */
export function isTerminalSuccess(status: EmailStatus): boolean {
  return status === 'SENT' || status === 'DELIVERED' || status === 'SUPPRESSED'
}
