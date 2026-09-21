import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { acceptInvitationSchema } from '@autoservices/validation'
import { InvitationsService } from './invitations.service.js'
import { zodBody } from '../../../common/pipes/zod-validation.pipe.js'
import { CurrentUser, Public, type AuthedUser } from '../../../common/decorators/index.js'
import { RateLimit } from '../../../common/guards/rate-limit.guard.js'

/**
 * WS-004 — the recipient's side, outside any workspace.
 *
 * These cannot live under `/workspaces/:id` because the caller is not a member yet: that
 * is the entire point of an invitation.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** Public so the landing page can name the workspace before asking anyone to sign in. */
  @Public()
  @Get('preview')
  // Tokens are unguessable, but the endpoint still should not be a free oracle.
  @RateLimit([{ limit: 20, windowSeconds: 900 }])
  async preview(@Query('token') token: string) {
    return { data: await this.invitations.preview(token ?? '') }
  }

  /** Requires a session: we join the invitation to a real account, never to an address. */
  @Post('accept')
  @RateLimit([{ limit: 10, windowSeconds: 900 }])
  async accept(
    @CurrentUser() user: AuthedUser,
    @Body(zodBody(acceptInvitationSchema)) body: unknown,
  ) {
    const { token } = body as { token: string }
    return {
      data: await this.invitations.accept(token, { id: user.id, email: user.email }),
    }
  }
}
