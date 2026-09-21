import { Injectable, Logger } from '@nestjs/common'
import { sanitiseMetadata } from '@autoservices/logger'
import type { AuditActorType } from '@autoservices/types'
import { PrismaService } from '../prisma.service.js'
import { currentContext } from '../context/request-context.js'

export interface AuditInput {
  workspaceId?: string | null
  actorType?: AuditActorType
  actorUserId?: string | null
  /** Set for staff actions; never populated from the customer request context. */
  actorAdminId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  ipHash?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Append-only audit trail (SECURITY.md §15).
 *
 * Metadata is sanitised before it is written — passwords, tokens and secrets must never
 * reach this table, whatever a caller passes in.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit')

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    const ctx = currentContext()
    try {
      await this.prisma.raw.auditLog.create({
        data: {
          workspaceId: input.workspaceId ?? ctx?.workspaceId ?? null,
          actorType: input.actorType ?? 'USER',
          actorUserId: input.actorUserId ?? (input.actorAdminId ? null : (ctx?.userId ?? null)),
          actorAdminId: input.actorAdminId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId ?? null,
          ipHash: input.ipHash ?? null,
          userAgent: input.userAgent ?? null,
          correlationId: ctx?.correlationId ?? null,
          metadata: input.metadata ? (sanitiseMetadata(input.metadata) as object) : undefined,
        },
      })
    } catch (err) {
      // An audit failure must never take down the operation being audited, but it must
      // be loud — a silently failing audit trail is worse than none.
      this.logger.error({ err, action: input.action }, 'Failed to write audit record')
    }
  }
}
