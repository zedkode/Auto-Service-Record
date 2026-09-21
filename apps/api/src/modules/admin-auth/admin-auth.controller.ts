import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { adminPermissionsFor } from '@autoservices/permissions'
import { AdminAuthService, ADMIN_SESSION_SECONDS } from './admin-auth.service.js'
import { zodBody } from '../../common/pipes/zod-validation.pipe.js'
import { Public } from '../../common/decorators/index.js'
import {
  ADMIN_COOKIE_NAME,
  AdminPublic,
  RequireAdmin,
} from '../../common/guards/admin-session.guard.js'
import { RateLimit } from '../../common/guards/rate-limit.guard.js'
import type { AdminIdentity } from './admin-auth.service.js'

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(200),
  totpCode: z.string().trim().min(6).max(10),
})

const codeSchema = z.object({ code: z.string().trim().min(6).max(10) })
type CodeInput = z.infer<typeof codeSchema>

/**
 * ADMIN-001 — the staff authentication realm.
 *
 * `@Public()` exempts these routes from the CUSTOMER session guard; the admin guard is
 * what actually protects them, and `@AdminPublic()` marks the two that must be reachable
 * without an admin session.
 */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Public()
  @AdminPublic()
  @Post('login')
  @HttpCode(200)
  // Tighter than the customer login: far fewer legitimate accounts, so a burst is
  // almost certainly an attack.
  @RateLimit([
    { limit: 5, windowSeconds: 900 },
    { limit: 10, windowSeconds: 900, keyField: 'email' },
  ])
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(zodBody(loginSchema)) body: unknown,
  ) {
    const input = body as z.infer<typeof loginSchema>
    const result = await this.adminAuth.login({
      email: input.email,
      password: input.password,
      totpCode: input.totpCode,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })

    void reply.setCookie(ADMIN_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      // Scoped to the admin API so it is never sent with a customer request.
      path: '/api/v1/admin',
      maxAge: ADMIN_SESSION_SECONDS,
    })

    return {
      data: {
        admin: result.admin,
        permissions: adminPermissionsFor(result.admin.role),
        expiresAt: result.expiresAt.toISOString(),
      },
    }
  }

  @Public()
  @AdminPublic()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.[
      ADMIN_COOKIE_NAME
    ]
    if (token) await this.adminAuth.logout(token)
    void reply.clearCookie(ADMIN_COOKIE_NAME, { path: '/api/v1/admin' })
  }

  @Public()
  @Get('session')
  @RequireAdmin('admin:metrics:read')
  async session(@Req() req: FastifyRequest) {
    const admin = (req as unknown as { admin: AdminIdentity }).admin
    return { data: { admin, permissions: adminPermissionsFor(admin.role) } }
  }

  @Public()
  @Post('mfa/confirm')
  @HttpCode(204)
  @RequireAdmin('admin:metrics:read')
  async confirmMfa(@Req() req: FastifyRequest, @Body(zodBody(codeSchema)) body: unknown) {
    const admin = (req as unknown as { admin: AdminIdentity }).admin
    await this.adminAuth.confirmEnrolment(admin.id, (body as CodeInput).code)
  }
}
