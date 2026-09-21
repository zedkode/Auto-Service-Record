import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { can } from '@autoservices/permissions'
import type { WorkspaceRole } from '@autoservices/types'
import type { UpdateMemberRoleInput } from '@autoservices/validation'
import { PrismaService } from '../../../common/prisma.service.js'
import { AuditService } from '../../../common/audit/audit.service.js'
import { DomainError, Errors } from '../../../common/errors.js'

/**
 * WS-002 — membership, roles and ownership transfer.
 *
 * Three invariants carry this module, and two of them are enforced by the database rather
 * than by this code:
 *
 *   1. exactly one ACTIVE OWNER per workspace — a partial unique index, so a racing
 *      double transfer fails loudly instead of leaving a workspace with two owners or none;
 *   2. an ADMIN may never modify or remove an OWNER — `can(...)` with `targetRole`;
 *   3. the last member cannot leave, because a workspace with no members owns vehicles
 *      nobody can reach.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger('Members')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async member(workspaceId: string, memberId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const found = await db.workspaceMember.findFirst({
      where: { id: memberId },
      include: { user: { include: { profile: true } } },
    })
    if (!found) throw Errors.notFound('Member')
    return found
  }

  async updateRole(
    workspaceId: string,
    memberId: string,
    actor: { userId: string; role: WorkspaceRole },
    input: UpdateMemberRoleInput,
  ) {
    const target = await this.member(workspaceId, memberId)

    // An ADMIN outranks an EDITOR but not an OWNER. The check needs the TARGET's role,
    // which is why the permission is evaluated here rather than by the route guard.
    if (!can(actor.role, 'member:update_role', { targetRole: target.role as WorkspaceRole })) {
      throw Errors.permissionDenied('change that member’s role')
    }
    if (target.role === 'OWNER') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The owner’s role cannot be changed directly. Transfer ownership instead.',
        422,
      )
    }
    if (target.userId === actor.userId) {
      // Otherwise an ADMIN could quietly promote themselves.
      throw new DomainError('VALIDATION_FAILED', 'You cannot change your own role.', 422)
    }

    const db = this.prisma.forWorkspace(workspaceId)
    const updated = await db.workspaceMember.update({
      where: { id: memberId },
      data: { role: input.role },
      include: { user: { include: { profile: true } } },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'member.role_changed',
      resourceType: 'workspace_member',
      resourceId: memberId,
      metadata: { from: target.role, to: input.role, userId: target.userId },
    })
    return this.view(updated)
  }

  async remove(
    workspaceId: string,
    memberId: string,
    actor: { userId: string; role: WorkspaceRole },
  ) {
    const target = await this.member(workspaceId, memberId)

    if (!can(actor.role, 'member:remove', { targetRole: target.role as WorkspaceRole })) {
      throw Errors.permissionDenied('remove that member')
    }
    if (target.role === 'OWNER') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'The owner cannot be removed. Transfer ownership first.',
        422,
      )
    }

    const db = this.prisma.forWorkspace(workspaceId)
    await db.workspaceMember.delete({ where: { id: memberId } })

    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'member.removed',
      resourceType: 'workspace_member',
      resourceId: memberId,
      metadata: { userId: target.userId, role: target.role },
    })
  }

  /** Leaving on your own account. The owner cannot; the last member cannot. */
  async leave(workspaceId: string, actor: { userId: string; role: WorkspaceRole }) {
    const db = this.prisma.forWorkspace(workspaceId)
    const me = await db.workspaceMember.findFirst({
      where: { userId: actor.userId, status: 'ACTIVE' },
    })
    if (!me) throw Errors.notFound('Member')

    if (me.role === 'OWNER') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'As the owner you cannot leave. Transfer ownership first, or delete the workspace.',
        422,
      )
    }

    await db.workspaceMember.delete({ where: { id: me.id } })
    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'member.left',
      resourceType: 'workspace_member',
      resourceId: me.id,
      metadata: { role: me.role },
    })
  }

  /**
   * Ownership transfer: one transaction, and the old owner is demoted BEFORE the new one
   * is promoted.
   *
   * That order is not cosmetic. The partial unique index permits exactly one ACTIVE OWNER
   * per workspace, so promoting first would violate it and abort the transaction. Demoting
   * first means the invariant holds at every intermediate state, and two concurrent
   * transfers still cannot both succeed — the second one finds no OWNER row to demote.
   */
  async transferOwnership(
    workspaceId: string,
    memberId: string,
    actor: { userId: string; role: WorkspaceRole },
  ) {
    if (actor.role !== 'OWNER') {
      throw Errors.permissionDenied('transfer ownership')
    }
    const target = await this.member(workspaceId, memberId)
    if (target.userId === actor.userId) {
      throw new DomainError('VALIDATION_FAILED', 'You already own this workspace.', 422)
    }
    if (target.status !== 'ACTIVE') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Ownership can only be transferred to an active member.',
        422,
      )
    }

    try {
      await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
        const demoted = await tx.workspaceMember.updateMany({
          where: { workspaceId, userId: actor.userId, role: 'OWNER', status: 'ACTIVE' },
          data: { role: 'ADMIN' },
        })
        // Zero rows means somebody else completed a transfer first; the caller is no
        // longer the owner and must not be able to appoint one.
        if (demoted.count !== 1) {
          throw new DomainError(
            'VALIDATION_FAILED',
            'Ownership has already changed. Reload and try again.',
            409,
          )
        }
        await tx.workspaceMember.update({
          where: { id: memberId },
          data: { role: 'OWNER' },
        })
        // The denormalised pointer on the workspace moves in the same transaction, or it
        // would disagree with the membership table.
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { ownerUserId: target.userId },
        })
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // The index caught a race this code did not.
        throw new DomainError(
          'VALIDATION_FAILED',
          'Ownership has already changed. Reload and try again.',
          409,
        )
      }
      throw err
    }

    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'workspace.ownership_transferred',
      resourceType: 'workspace',
      resourceId: workspaceId,
      metadata: { from: actor.userId, to: target.userId },
    })
    this.logger.warn(
      { workspaceId, from: actor.userId, to: target.userId },
      'workspace ownership transferred',
    )
    return this.list(workspaceId)
  }

  async list(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const members = await db.workspaceMember.findMany({
      where: { status: 'ACTIVE' },
      include: { user: { include: { profile: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
    return members.map((m) => this.view(m))
  }

  private view(
    m: Prisma.WorkspaceMemberGetPayload<{
      include: { user: { include: { profile: true } } }
    }>,
  ) {
    return {
      id: m.id,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt?.toISOString() ?? null,
      user: {
        id: m.user.id,
        email: m.user.email,
        displayName: m.user.profile?.displayName ?? m.user.email,
      },
    }
  }
}
