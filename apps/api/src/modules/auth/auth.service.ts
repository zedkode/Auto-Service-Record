import { randomBytes } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  createTokenPair,
  hashToken,
  hashPassword,
  hashIp,
  verifyPasswordTimingSafe,
  SESSION_ABSOLUTE_LIFETIME_S,
  EMAIL_VERIFICATION_LIFETIME_S,
  PASSWORD_RESET_LIFETIME_S,
  expiresIn,
} from '@autoservices/auth'
import { QueueService } from '../../common/queue/queue.service.js'
import type { RegisterInput, LoginInput } from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'

const MAX_FAILED_ATTEMPTS = 10

/**
 * Workspace slugs must be globally unique.
 *
 * Deriving one from the user's id is NOT safe: ids are UUIDv7, which is time-ordered, so
 * any two users registering in the same window share a prefix and the second signup fails.
 * A random suffix makes collisions vanishingly unlikely, and the retry below covers the
 * remainder rather than surfacing a 500 to someone creating an account.
 */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'workspace'
}

function slugCandidate(name: string): string {
  return `${slugify(name)}-${randomBytes(5).toString('hex')}`
}

const SLUG_ATTEMPTS = 5

export interface SessionResult {
  token: string
  expiresAt: Date
  userId: string
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly ipSalt: string,
    private readonly appUrl: string,
  ) {}

  /**
   * Registration bootstraps a tenant. User, profile, personal workspace, OWNER
   * membership — ONE transaction. Partial registration state is a support burden
   * forever (TASKS.md AUTH-001).
   */
  async register(input: RegisterInput, meta: { ip?: string; userAgent?: string }) {
    const existing = await this.prisma.raw.user.findUnique({ where: { email: input.email } })
    if (existing) {
      // Uniform response: registration must not confirm which emails exist.
      throw Errors.emailAlreadyRegistered()
    }

    const passwordHash = await hashPassword(input.password)

    const { user, workspace } = await this.createUserWithWorkspace(input, passwordHash)

    await this.audit.record({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: 'user.registered',
      resourceType: 'user',
      resourceId: user.id,
      ipHash: meta.ip ? hashIp(meta.ip, this.ipSalt) : null,
      userAgent: meta.userAgent ?? null,
    })

    // Fire-and-forget: the user is registered whether or not the mail provider is up.
    await this.issueVerificationEmail(user.id, user.email, input.displayName)

    const session = await this.createSession(user.id, meta)
    return { user, workspace, session }
  }

  // ---------------------------------------------------------------------------
  // Email verification (AUTH-002)
  // ---------------------------------------------------------------------------

  /**
   * Issues a verification token and queues the email. The plaintext token exists only
   * in the message we send; the database stores its SHA-256 hash (SECURITY.md §4).
   */
  async issueVerificationEmail(userId: string, email: string, displayName: string): Promise<void> {
    const { token, tokenHash } = createTokenPair()

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      // Issuing a new token invalidates any outstanding one.
      await tx.emailVerificationToken.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      await tx.emailVerificationToken.create({
        data: { userId, tokenHash, expiresAt: expiresIn(EMAIL_VERIFICATION_LIFETIME_S) },
      })
    })

    await this.queue.sendEmail({
      template: 'verify-email',
      to: email,
      category: 'ACCOUNT',
      // Keyed on the token itself: each issued token yields exactly one email, and a
      // worker retry cannot produce a second.
      idempotencyKey: `verify:${tokenHash}`,
      userId,
      props: {
        displayName,
        url: `${this.appUrl}/verify-email?token=${encodeURIComponent(token)}`,
      },
    })
  }

  async verifyEmail(token: string): Promise<{ userId: string; alreadyVerified: boolean }> {
    const record = await this.prisma.raw.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { profile: true } } },
    })

    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw Errors.tokenInvalid()
    }

    if (record.user.emailVerifiedAt) {
      await this.prisma.raw.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      })
      return { userId: record.userId, alreadyVerified: true }
    }

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      })
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
      })
    })

    await this.audit.record({
      actorUserId: record.userId,
      action: 'user.email_verified',
      resourceType: 'user',
      resourceId: record.userId,
    })

    await this.queue.sendEmail({
      template: 'welcome',
      to: record.user.email,
      category: 'ACCOUNT',
      idempotencyKey: `welcome:${record.userId}`,
      userId: record.userId,
      props: {
        displayName: record.user.profile?.displayName ?? 'there',
        url: `${this.appUrl}/vehicles/new`,
      },
    })

    return { userId: record.userId, alreadyVerified: false }
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.raw.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    })
    if (!user || user.emailVerifiedAt) return // Nothing to do; never an error.
    await this.issueVerificationEmail(user.id, user.email, user.profile?.displayName ?? 'there')
  }

  // ---------------------------------------------------------------------------
  // Password reset (AUTH-004)
  // ---------------------------------------------------------------------------

  /**
   * Always returns normally, whether or not the address exists. A different response
   * for a known address is an account-enumeration oracle (SECURITY.md §4).
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.raw.user.findUnique({
      where: { email },
      include: { profile: true },
    })
    if (!user || user.deletedAt) {
      this.logger.debug({ email }, 'password reset requested for unknown address')
      return
    }

    const { token, tokenHash } = createTokenPair()
    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: expiresIn(PASSWORD_RESET_LIFETIME_S) },
      })
    })

    await this.audit.record({
      actorUserId: user.id,
      action: 'user.password_reset_requested',
      resourceType: 'user',
      resourceId: user.id,
    })

    await this.queue.sendEmail({
      template: 'password-reset',
      to: user.email,
      category: 'ACCOUNT',
      idempotencyKey: `reset:${tokenHash}`,
      userId: user.id,
      props: {
        displayName: user.profile?.displayName ?? 'there',
        url: `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`,
      },
    })
  }

  /** Consuming a reset token revokes every session for that user (SECURITY.md §4). */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.raw.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })

    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw Errors.tokenInvalid()
    }

    const passwordHash = await hashPassword(newPassword)

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      })
      // Any other outstanding reset tokens die with this one.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      })
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      })
    })

    await this.audit.record({
      actorUserId: record.userId,
      action: 'user.password_reset',
      resourceType: 'user',
      resourceId: record.userId,
    })

    await this.queue.sendEmail({
      template: 'password-changed',
      to: record.user.email,
      category: 'SECURITY',
      idempotencyKey: `pwchanged:${record.id}`,
      userId: record.userId,
      props: { url: `${this.appUrl}/sign-in` },
    })
  }

  async login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.raw.user.findUnique({ where: { email: input.email } })

    // Always performs a hash comparison, even when the user does not exist, so login
    // timing does not reveal account existence (SECURITY.md §4).
    const valid = await verifyPasswordTimingSafe(user?.passwordHash, input.password)

    if (!user || !valid || user.deletedAt) {
      if (user) await this.recordFailedAttempt(user.id, user.failedLoginCount)
      throw Errors.invalidCredentials()
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw Errors.accountLocked()
    if (user.status === 'SUSPENDED') throw Errors.accountSuspended()

    await this.prisma.raw.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    })

    await this.audit.record({
      actorUserId: user.id,
      action: 'user.login',
      resourceType: 'user',
      resourceId: user.id,
      ipHash: meta.ip ? hashIp(meta.ip, this.ipSalt) : null,
      userAgent: meta.userAgent ?? null,
    })

    const session = await this.createSession(user.id, meta)
    return { user, session }
  }

  /**
   * The registration transaction: user + profile + workspace + OWNER membership, all or
   * nothing. Retried only on a slug collision — any other failure propagates.
   */
  private async createUserWithWorkspace(input: RegisterInput, passwordHash: string) {
    let lastError: unknown

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const slug = slugCandidate('My Garage')
      try {
        return await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
          const user = await tx.user.create({
            data: {
              email: input.email,
              passwordHash,
              // Unverified accounts can sign in and use the app, but cannot create a
              // second workspace, invite members, or receive non-transactional email
              // (PRODUCT.md §5.1). Verification promotes the status to ACTIVE.
              status: 'PENDING_VERIFICATION',
              emailVerifiedAt: null,
              profile: { create: { displayName: input.displayName } },
            },
          })

          const workspace = await tx.workspace.create({
            data: {
              name: 'My Garage',
              slug,
              type: 'PERSONAL',
              ownerUserId: user.id,
              members: {
                create: { userId: user.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
              },
            },
          })

          return { user, workspace }
        })
      } catch (err) {
        const isSlugCollision =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          String(err.meta?.target ?? '').includes('slug')

        if (!isSlugCollision) throw err
        lastError = err
        this.logger.warn({ attempt, slug }, 'workspace slug collision, retrying')
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Could not allocate a unique workspace slug')
  }

  private async recordFailedAttempt(userId: string, current: number): Promise<void> {
    const next = current + 1
    await this.prisma.raw.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil: next >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + 15 * 60_000) : null,
      },
    })
  }

  async createSession(
    userId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<SessionResult> {
    const { token, tokenHash } = createTokenPair()
    const expires = expiresIn(SESSION_ABSOLUTE_LIFETIME_S)

    await this.prisma.raw.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt: expires,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        ipHash: meta.ip ? hashIp(meta.ip, this.ipSalt) : null,
      },
    })

    return { token, expiresAt: expires, userId }
  }

  async revokeSession(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.raw.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
  }

  /**
   * DEVELOPMENT ONLY. Signs in the seeded developer account without a password so the
   * dashboard is usable immediately.
   *
   * Three independent guards prevent this reaching production:
   *   1. DEV_AUTH_ENABLED must be true,
   *   2. NODE_ENV must not be 'production' (checked here AND in packages/config),
   *   3. the route is not registered at all unless both hold.
   */
  async devLogin(email: string, meta: { ip?: string; userAgent?: string }) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('devLogin is not available in production')
    }
    const user = await this.prisma.raw.user.findUnique({ where: { email } })
    if (!user) throw Errors.invalidCredentials()

    this.logger.warn(`DEV AUTH: issuing a session for ${email} without a password`)
    const session = await this.createSession(user.id, meta)
    return { user, session }
  }
}
