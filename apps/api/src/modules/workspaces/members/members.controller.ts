import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common'
import {
  inviteMemberSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
} from '@autoservices/validation'
import { MembersService } from './members.service.js'
import { InvitationsService } from './invitations.service.js'
import { zodBody } from '../../../common/pipes/zod-validation.pipe.js'
import {
  CurrentUser,
  CurrentWorkspace,
  RequirePermission,
  type AuthedUser,
  type WorkspaceContext,
} from '../../../common/decorators/index.js'

/**
 * WS-002/003/004 — who is in a workspace, and how they got there.
 *
 * Several routes declare a coarse permission and then re-check it against the TARGET's
 * role inside the service: "an ADMIN may change a role" is true in general and false when
 * the target is the OWNER, which a route decorator cannot express.
 */
@Controller('workspaces/:workspaceId')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('members')
  @RequirePermission('workspace:read')
  async list(@CurrentWorkspace() ws: WorkspaceContext) {
    const data = await this.members.list(ws.workspaceId)
    return { data, meta: { total: data.length } }
  }

  @Patch('members/:memberId')
  @RequirePermission('member:update_role')
  async updateRole(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('memberId') memberId: string,
    @Body(zodBody(updateMemberRoleSchema)) body: unknown,
  ) {
    return {
      data: await this.members.updateRole(
        ws.workspaceId,
        memberId,
        { userId: user.id, role: ws.role },
        body as never,
      ),
    }
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermission('member:remove')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('memberId') memberId: string,
  ) {
    await this.members.remove(ws.workspaceId, memberId, { userId: user.id, role: ws.role })
  }

  /** Leaving needs no permission beyond being a member. */
  @Post('members/leave')
  @HttpCode(204)
  @RequirePermission('workspace:read')
  async leave(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthedUser) {
    await this.members.leave(ws.workspaceId, { userId: user.id, role: ws.role })
  }

  @Post('members/transfer-ownership')
  @RequirePermission('workspace:update')
  async transferOwnership(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(transferOwnershipSchema)) body: unknown,
  ) {
    const input = body as { memberId: string }
    const data = await this.members.transferOwnership(ws.workspaceId, input.memberId, {
      userId: user.id,
      role: ws.role,
    })
    return { data, meta: { total: data.length } }
  }

  // --- invitations ---

  @Get('invitations')
  @RequirePermission('member:invite')
  async listInvitations(@CurrentWorkspace() ws: WorkspaceContext) {
    const data = await this.invitations.list(ws.workspaceId)
    return { data, meta: { total: data.length } }
  }

  @Post('invitations')
  @RequirePermission('member:invite')
  async invite(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(inviteMemberSchema)) body: unknown,
  ) {
    return {
      data: await this.invitations.invite(
        ws.workspaceId,
        { userId: user.id, displayName: user.displayName },
        body as never,
      ),
    }
  }

  @Delete('invitations/:invitationId')
  @RequirePermission('member:invite')
  async revoke(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthedUser,
    @Param('invitationId') invitationId: string,
  ) {
    return { data: await this.invitations.revoke(ws.workspaceId, invitationId, user.id) }
  }
}
