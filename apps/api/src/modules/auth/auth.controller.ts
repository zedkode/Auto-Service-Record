import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@autoservices/validation'
import { AuthService } from './auth.service.js'
import { PrismaService } from '../../common/prisma.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import { CurrentUser, Public, type AuthedUser } from '../../common/decorators/index.js'
import { RateLimit } from '../../common/guards/rate-limit.guard.js'
import { Errors } from '../../common/errors.js'

export interface CookieOptions {
  name: string
  domain: string
  secure: boolean
}

export const COOKIE_OPTIONS = Symbol('COOKIE_OPTIONS')
export const DEV_AUTH_ENABLED = Symbol('DEV_AUTH_ENABLED')

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(COOKIE_OPTIONS) private readonly cookie: CookieOptions,
    @Inject(DEV_AUTH_ENABLED) private readonly devAuthEnabled: boolean,
  ) {}

  private setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    void reply.setCookie(this.cookie.name, token, {
      httpOnly: true,
      secure: this.cookie.secure,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    })
  }

  private meta(req: FastifyRequest) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] }
  }

  @Public()
  @RateLimit([{ limit: 3, windowSeconds: 3600 }])
  @Post('register')
  async register(
    @Body(zodBody(registerSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = body as Parameters<AuthService['register']>[0]
    const { user, workspace, session } = await this.auth.register(input, this.meta(req))
    this.setSessionCookie(reply, session.token, session.expiresAt)
    void reply.status(201)
    return {
      data: {
        user: { id: user.id, email: user.email },
        workspace: { id: workspace.id, name: workspace.name },
      },
    }
  }

  @Public()
  @RateLimit([
    { limit: 5, windowSeconds: 900, keyField: 'email' },
    { limit: 20, windowSeconds: 3600 },
  ])
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(zodBody(loginSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = body as Parameters<AuthService['login']>[0]
    const { user, session } = await this.auth.login(input, this.meta(req))
    this.setSessionCookie(reply, session.token, session.expiresAt)
    return { data: { user: { id: user.id, email: user.email } } }
  }

  /**
   * DEVELOPMENT ONLY — see AuthService.devLogin. Returns 404 in any environment where
   * the dev shortcut is not explicitly enabled, so it does not even advertise itself.
   */
  @Public()
  @HttpCode(200)
  @Post('dev-login')
  async devLogin(
    @Body() body: { email?: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.devAuthEnabled || process.env.NODE_ENV === 'production') {
      throw Errors.notFound('Route')
    }
    const email = body?.email ?? 'andrei@autoservices.local'
    const { user, session } = await this.auth.devLogin(email, this.meta(req))
    this.setSessionCookie(reply, session.token, session.expiresAt)
    return { data: { user: { id: user.id, email: user.email }, devAuth: true } }
  }

  @Public()
  @RateLimit([{ limit: 10, windowSeconds: 3600 }])
  @HttpCode(200)
  @Post('verify-email')
  async verifyEmail(@Body(zodBody(verifyEmailSchema)) body: unknown) {
    const { token } = body as { token: string }
    const result = await this.auth.verifyEmail(token)
    return { data: { verified: true, alreadyVerified: result.alreadyVerified } }
  }

  @RateLimit([{ limit: 3, windowSeconds: 3600 }])
  @HttpCode(200)
  @Post('verify-email/resend')
  async resendVerification(@CurrentUser() user: AuthedUser) {
    await this.auth.resendVerification(user.id)
    return { data: { sent: true } }
  }

  /** Uniform response whether or not the address exists (SECURITY.md §4). */
  @Public()
  @RateLimit([
    { limit: 3, windowSeconds: 3600, keyField: 'email' },
    { limit: 10, windowSeconds: 3600 },
  ])
  @HttpCode(200)
  @Post('forgot-password')
  async forgotPassword(@Body(zodBody(forgotPasswordSchema)) body: unknown) {
    const { email } = body as { email: string }
    await this.auth.requestPasswordReset(email)
    return {
      data: {
        message: 'If that address has an account, a reset link is on its way.',
      },
    }
  }

  @Public()
  @RateLimit([{ limit: 10, windowSeconds: 3600 }])
  @HttpCode(200)
  @Post('reset-password')
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token, password } = body as { token: string; password: string }
    await this.auth.resetPassword(token, password)
    // Every session was revoked, including any this browser held.
    void reply.clearCookie(this.cookie.name, { path: '/' })
    return { data: { reset: true } }
  }

  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const sessionId = (req as unknown as { sessionId?: string }).sessionId
    if (sessionId) await this.auth.revokeSession(sessionId)
    void reply.clearCookie(this.cookie.name, { path: '/' })
    return { data: { ok: true } }
  }

  /** Current user plus the workspaces they belong to — the dashboard's bootstrap call. */
  @Get('session')
  async session(@CurrentUser() user: AuthedUser) {
    type MembershipWithWorkspace = Prisma.WorkspaceMemberGetPayload<{
      include: { workspace: true }
    }>

    const memberships = await this.prisma.raw.workspaceMember.findMany({
      where: { userId: user.id, status: 'ACTIVE', workspace: { deletedAt: null } },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    })

    return {
      data: {
        user,
        workspaces: memberships.map((m: MembershipWithWorkspace) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          type: m.workspace.type,
          role: m.role,
          defaultCurrency: m.workspace.defaultCurrency,
          defaultDistanceUnit: m.workspace.defaultDistanceUnit,
        })),
      },
    }
  }
}
