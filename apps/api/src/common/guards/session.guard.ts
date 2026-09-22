import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'
import { hashToken } from '@autoservices/auth'
import { PrismaService } from '../prisma.service.js'
import { Errors } from '../errors.js'
import { IS_PUBLIC } from '../decorators/index.js'

/**
 * TENANT ISOLATION — LAYER 1a. Resolves the session cookie to a user.
 * Only the token's hash is ever compared against the database (SECURITY.md §5).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly cookieName: string,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const req = context.switchToHttp().getRequest<FastifyRequest & Record<string, unknown>>()
    const token = (req as { cookies?: Record<string, string> }).cookies?.[this.cookieName]
    if (!token) throw Errors.unauthenticated()

    /**
     * `relationLoadStrategy: 'join'` because this runs on EVERY authenticated request.
     * Prisma's default strategy issues one query per level of `include`, so session →
     * user → profile cost three round trips before any endpoint did its own work — the
     * largest fixed cost in the application, paid on requests that then read a single
     * table (HARD-004). One LATERAL join instead.
     */
    const session = await this.prisma.raw.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { profile: true } } },
      relationLoadStrategy: 'join',
    })

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Errors.unauthenticated()
    }
    if (session.user.deletedAt || session.user.status === 'SUSPENDED') {
      throw Errors.accountSuspended()
    }

    req.authUser = {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerifiedAt !== null,
      displayName: session.user.profile?.displayName ?? session.user.email,
      timezone: session.user.profile?.timezone ?? 'Europe/London',
      preferredDistanceUnit: session.user.profile?.preferredDistanceUnit ?? 'MILES',
      preferredCurrency: session.user.profile?.preferredCurrency ?? 'GBP',
    }
    req.sessionId = session.id

    // Throttled to one write per 5 minutes rather than a write per request.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000)
    if (session.lastSeenAt < fiveMinutesAgo) {
      void this.prisma.raw.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined)
    }

    return true
  }
}
