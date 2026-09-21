import { Prisma, type PrismaClient } from '@prisma/client'

export type EmailSuppressionReason = 'HARD_BOUNCE' | 'COMPLAINT' | 'MANUAL'

export interface SuppressInput {
  email: string
  reason: EmailSuppressionReason
  detail?: string | null
  sourceEventId?: string | null
  sourceMessageId?: string | null
}

export interface SuppressionRow {
  id: string
  email: string
  reason: EmailSuppressionReason
  detail: string | null
  createdAt: Date
  releasedAt: Date | null
  releasedBy: string | null
}

/**
 * The list of addresses we refuse to send to (MAIL-005, EMAILS.md §7).
 *
 * Deliberately NOT workspace-scoped: a mailbox that no longer exists does not exist for
 * any tenant, and a spam complaint follows the address, not the workspace. It therefore
 * has no `workspaceId` and is correctly absent from the tenant client's model set.
 */
export class EmailSuppressionStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Whether this address is currently refused. A released row does not suppress: the
   * history is kept, but it no longer blocks.
   */
  async isSuppressed(email: string): Promise<SuppressionRow | null> {
    const row = await this.prisma.emailSuppression.findFirst({
      where: { email, releasedAt: null },
    })
    return row ? (row as unknown as SuppressionRow) : null
  }

  /**
   * Adds or refreshes a suppression.
   *
   * A repeat bounce on an address an operator already released must suppress it again,
   * so this clears `releasedAt` rather than leaving a released row in place — otherwise
   * one manual release would permanently disarm the protection for that address.
   */
  async suppress(input: SuppressInput): Promise<{ id: string; created: boolean }> {
    const data = {
      reason: input.reason as never,
      detail: input.detail ?? null,
      sourceEventId: input.sourceEventId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      releasedAt: null,
      releasedBy: null,
    }
    try {
      const created = await this.prisma.emailSuppression.create({
        data: { email: input.email, ...data },
      })
      return { id: created.id, created: true }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const updated = await this.prisma.emailSuppression.update({
          where: { email: input.email },
          data,
        })
        return { id: updated.id, created: false }
      }
      throw err
    }
  }

  /** Lifts a suppression, keeping the row as history. */
  async release(email: string, releasedBy: string): Promise<boolean> {
    const result = await this.prisma.emailSuppression.updateMany({
      where: { email, releasedAt: null },
      data: { releasedAt: new Date(), releasedBy },
    })
    return result.count > 0
  }

  async list(
    options: { includeReleased?: boolean; limit?: number } = {},
  ): Promise<SuppressionRow[]> {
    const rows = await this.prisma.emailSuppression.findMany({
      where: options.includeReleased ? {} : { releasedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.min(options.limit ?? 100, 500),
    })
    return rows as unknown as SuppressionRow[]
  }

  async count(): Promise<number> {
    return this.prisma.emailSuppression.count({ where: { releasedAt: null } })
  }
}
