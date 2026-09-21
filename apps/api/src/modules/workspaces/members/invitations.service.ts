import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { generateToken, hashToken } from '@autoservices/auth'
import type { InviteMemberInput } from '@autoservices/validation'
import { PrismaService } from '../../../common/prisma.service.js'
import { AuditService } from '../../../common/audit/audit.service.js'
import { QueueService } from '../../../common/queue/queue.service.js'
import { DomainError, Errors } from '../../../common/errors.js'

const INVITATION_DAYS = 7

/**
 * WS-003/004 — invitations and acceptance.
 *
 * The token follows the same rule as every other credential here: the plaintext exists
 * only in the email, and the database holds nothing but its SHA-256 hash. A leak of the
 * invitations table therefore yields no usable invitation.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger('Invitations')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async invite(
    workspaceId: string,
    actor: { userId: string; displayName: string },
    input: InviteMemberInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)

    const workspace = await this.prisma.raw.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!workspace) throw Errors.workspaceNotFound()

    // Already a member? Say so plainly rather than sending an invitation that will fail
    // on acceptance.
    const existing = await db.workspaceMember.findFirst({
      where: { user: { email: input.email }, status: 'ACTIVE' },
      include: { user: true },
    })
    if (existing) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'That person is already a member of this workspace.',
        422,
      )
    }

    // A second invitation supersedes the first, so a resend does not leave two live
    // tokens for the same address.
    await db.workspaceInvitation.updateMany({
      where: { email: input.email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    const token = generateToken(32)
    const invitation = await db.workspaceInvitation.create({
      data: {
        workspaceId,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedByUserId: actor.userId,
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
      },
    })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3101'
    await this.queue.sendEmail({
      template: 'workspace-invitation',
      to: input.email,
      category: 'ACCOUNT',
      idempotencyKey: `invite:${invitation.id}`,
      workspaceId,
      props: {
        inviterName: actor.displayName,
        workspaceName: workspace.name,
        role: input.role.toLowerCase(),
        url: `${appUrl}/invitations/accept?token=${token}`,
      },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: actor.userId,
      action: 'member.invited',
      resourceType: 'workspace_invitation',
      resourceId: invitation.id,
      // The address is the point of the record; the token never appears.
      metadata: { email: input.email, role: input.role },
    })
    return this.view(invitation)
  }

  async list(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.workspaceInvitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((r) => this.view(r))
  }

  async revoke(workspaceId: string, invitationId: string, actorUserId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const invitation = await db.workspaceInvitation.findFirst({ where: { id: invitationId } })
    if (!invitation) throw Errors.notFound('Invitation')
    if (invitation.acceptedAt) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'That invitation has already been accepted. Remove the member instead.',
        422,
      )
    }

    const updated = await db.workspaceInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    })
    await this.audit.record({
      workspaceId,
      actorUserId,
      action: 'member.invitation_revoked',
      resourceType: 'workspace_invitation',
      resourceId: invitationId,
      metadata: { email: invitation.email },
    })
    return this.view(updated)
  }

  /**
   * Shows who the invitation is for, before the recipient signs in. Deliberately thin:
   * workspace name and role, nothing about the members or the vehicles.
   */
  async preview(token: string) {
    const invitation = await this.prisma.raw.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: { select: { name: true } } },
    })
    if (!invitation || !this.isLive(invitation)) throw Errors.tokenInvalid()

    return {
      workspaceName: invitation.workspace.name,
      role: invitation.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    }
  }

  /**
   * Acceptance. Runs as the signed-in user, and refuses when the invitation was addressed
   * to somebody else — otherwise a forwarded email would be an access grant to whoever
   * opened it first.
   */
  async accept(token: string, user: { id: string; email: string }) {
    const invitation = await this.prisma.raw.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
    })
    if (!invitation || !this.isLive(invitation)) throw Errors.tokenInvalid()

    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
        422,
      )
    }

    const already = await this.prisma.raw.workspaceMember.findFirst({
      where: { workspaceId: invitation.workspaceId, userId: user.id },
    })
    if (already) {
      await this.prisma.raw.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      })
      return { workspaceId: invitation.workspaceId, alreadyMember: true }
    }

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId: user.id,
          role: invitation.role,
          status: 'ACTIVE',
          invitedByUserId: invitation.invitedByUserId,
          joinedAt: new Date(),
        },
      })
      // Burned in the same transaction as the membership, so a token can never admit two
      // people even under concurrency.
      await tx.workspaceInvitation.update({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      })
    })

    await this.audit.record({
      workspaceId: invitation.workspaceId,
      actorUserId: user.id,
      action: 'member.joined',
      resourceType: 'workspace_member',
      resourceId: invitation.id,
      metadata: { role: invitation.role, invitedBy: invitation.invitedByUserId },
    })
    this.logger.log(
      { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role },
      'invitation accepted',
    )
    return { workspaceId: invitation.workspaceId, alreadyMember: false }
  }

  private isLive(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
    return !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date()
  }

  private view(i: {
    id: string
    email: string
    role: string
    expiresAt: Date
    acceptedAt: Date | null
    revokedAt: Date | null
    createdAt: Date
  }) {
    return {
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      revokedAt: i.revokedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      // The token is never returned. It exists in the email and nowhere else.
    }
  }
}
