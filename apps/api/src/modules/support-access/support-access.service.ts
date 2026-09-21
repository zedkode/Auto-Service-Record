import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { DomainError, Errors } from '../../common/errors.js'

export type SupportScope = 'VEHICLE_CONTENT' | 'DOCUMENTS' | 'FULL'

/** SECURITY.md §13 — a grant may not outlive the working day it was needed for. */
export const MAX_GRANT_HOURS = 24
/** Long enough that "debugging" does not pass, short enough not to be a chore. */
export const MIN_REASON_LENGTH = 20

export interface GrantRequest {
  adminUserId: string
  workspaceId: string
  reason: string
  scope: SupportScope
  hours: number
}

/**
 * SEC-018 — audited, time-boxed support access.
 *
 * No admin role holds a permission that reads customer vehicle content or documents, so
 * this is not an escalation of an existing right: it *is* the right. That makes three
 * properties load-bearing rather than decorative —
 *
 *   1. a written reason, long enough to be a reason;
 *   2. an expiry, capped at 24 hours and never extendable in place;
 *   3. an audit row for **every use**, not merely for the granting.
 *
 * (3) is the one that is easy to skip and the one that matters: a grant that is recorded
 * once and then used silently for a day is indistinguishable from unrestricted access.
 */
@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger('SupportAccess')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async request(input: GrantRequest) {
    const reason = input.reason.trim()
    if (reason.length < MIN_REASON_LENGTH) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Give a reason of at least ${MIN_REASON_LENGTH} characters. It is read by whoever reviews this later.`,
        422,
      )
    }
    if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > MAX_GRANT_HOURS) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Access can last between 1 and ${MAX_GRANT_HOURS} hours.`,
        422,
      )
    }

    const workspace = await this.prisma.raw.workspace.findFirst({
      where: { id: input.workspaceId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!workspace) throw Errors.workspaceNotFound()

    // An existing live grant is returned rather than stacked, so "how long has this
    // person had access?" has one answer instead of a pile of overlapping ones.
    const existing = await this.activeGrant(input.adminUserId, input.workspaceId, input.scope)
    if (existing) return this.view(existing)

    const grant = await this.prisma.raw.supportAccessGrant.create({
      data: {
        adminUserId: input.adminUserId,
        workspaceId: input.workspaceId,
        reason,
        scope: input.scope,
        expiresAt: new Date(Date.now() + input.hours * 3_600_000),
      },
    })

    await this.audit.record({
      workspaceId: input.workspaceId,
      actorType: 'ADMIN',
      actorAdminId: input.adminUserId,
      action: 'support_access.granted',
      resourceType: 'support_access_grant',
      resourceId: grant.id,
      metadata: { scope: input.scope, hours: input.hours, reason },
    })
    this.logger.warn(
      { grantId: grant.id, adminId: input.adminUserId, workspaceId: input.workspaceId },
      'support access granted',
    )
    return this.view(grant)
  }

  async revoke(grantId: string, revokedBy: string) {
    const grant = await this.prisma.raw.supportAccessGrant.findUnique({ where: { id: grantId } })
    if (!grant) throw Errors.notFound('Grant')
    if (grant.revokedAt) return this.view(grant)

    const updated = await this.prisma.raw.supportAccessGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedBy },
    })
    await this.audit.record({
      workspaceId: grant.workspaceId,
      actorType: 'ADMIN',
      actorAdminId: revokedBy,
      action: 'support_access.revoked',
      resourceType: 'support_access_grant',
      resourceId: grantId,
      metadata: { grantedTo: grant.adminUserId },
    })
    return this.view(updated)
  }

  /** The register. Deliberately visible to every admin role that can read anything. */
  async list(options: { includeExpired?: boolean } = {}) {
    const rows = await this.prisma.raw.supportAccessGrant.findMany({
      where: options.includeExpired ? {} : { revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { grantedAt: 'desc' },
      take: 200,
      include: {
        adminUser: { select: { email: true, role: true } },
        workspace: { select: { name: true } },
      },
    })
    return rows.map((r) => ({
      ...this.view(r),
      adminEmail: r.adminUser.email,
      adminRole: r.adminUser.role,
      workspaceName: r.workspace.name,
    }))
  }

  private async activeGrant(adminUserId: string, workspaceId: string, scope: SupportScope) {
    return this.prisma.raw.supportAccessGrant.findFirst({
      where: {
        adminUserId,
        workspaceId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        // A FULL grant satisfies a narrower requirement; a narrow one never satisfies FULL.
        scope: scope === 'FULL' ? 'FULL' : { in: [scope, 'FULL'] },
      },
      orderBy: { expiresAt: 'desc' },
    })
  }

  /**
   * The gate. Throws unless a live grant covers this admin, workspace and scope, and
   * records the use either way — a refused attempt is at least as interesting as a
   * successful one.
   */
  async assertAccess(input: {
    adminUserId: string
    workspaceId: string
    scope: SupportScope
    action: string
    resourceType: string
    resourceId?: string
  }): Promise<void> {
    const grant = await this.activeGrant(input.adminUserId, input.workspaceId, input.scope)

    if (!grant) {
      await this.audit.record({
        workspaceId: input.workspaceId,
        actorType: 'ADMIN',
        actorAdminId: input.adminUserId,
        action: 'support_access.denied',
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: { scope: input.scope, attempted: input.action },
      })
      this.logger.warn(
        { adminId: input.adminUserId, workspaceId: input.workspaceId, scope: input.scope },
        'support access denied — no live grant',
      )
      // 404, consistent with the rest of the admin surface: no confirmation that the
      // workspace exists, only that this staff member cannot see it.
      throw Errors.notFound('Route')
    }

    await this.prisma.raw.supportAccessGrant.update({
      where: { id: grant.id },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    await this.audit.record({
      workspaceId: input.workspaceId,
      actorType: 'ADMIN',
      actorAdminId: input.adminUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: { grantId: grant.id, scope: grant.scope },
    })
  }

  private view(g: {
    id: string
    adminUserId: string
    workspaceId: string
    reason: string
    scope: string
    grantedAt: Date
    expiresAt: Date
    revokedAt: Date | null
    useCount: number
    lastUsedAt: Date | null
  }) {
    const now = Date.now()
    return {
      id: g.id,
      adminUserId: g.adminUserId,
      workspaceId: g.workspaceId,
      reason: g.reason,
      scope: g.scope,
      grantedAt: g.grantedAt.toISOString(),
      expiresAt: g.expiresAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
      useCount: g.useCount,
      lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
      // Computed here so the console cannot disagree with the server about whether a
      // grant is live (DECISIONS.md D-041, D-053).
      isActive: !g.revokedAt && g.expiresAt.getTime() > now,
      minutesRemaining: Math.max(0, Math.round((g.expiresAt.getTime() - now) / 60_000)),
    }
  }
}
