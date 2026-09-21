import { Injectable, Logger } from '@nestjs/common'
import {
  generateToken,
  generateTotpSecret,
  hashIp,
  hashToken,
  hashPassword,
  openSecret,
  sealSecret,
  totpUri,
  verifyPassword,
  verifyTotp,
} from '@autoservices/auth'
import type { AdminRole } from '@autoservices/permissions'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { DomainError, Errors } from '../../common/errors.js'

/** 8 hours (SECURITY.md §5) — deliberately far shorter than a customer session. */
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

export interface AdminIdentity {
  id: string
  email: string
  role: AdminRole
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger('AdminAuth')

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get encryptionKey(): string {
    const secret = process.env.SESSION_SECRET ?? ''
    if (secret.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters to protect MFA secrets.')
    }
    return secret
  }

  /**
   * Password + TOTP in a single step.
   *
   * 2FA is mandatory (SECURITY.md §13): an account that has not completed enrolment
   * cannot sign in at all, rather than being allowed through "just this once".
   */
  async login(input: {
    email: string
    password: string
    totpCode: string
    ip: string
    userAgent?: string
  }): Promise<{ token: string; admin: AdminIdentity; expiresAt: Date }> {
    const admin = await this.prisma.raw.adminUser.findUnique({ where: { email: input.email } })

    // Same error and roughly the same work for every failure, so the response does not
    // reveal whether the address exists or which factor was wrong.
    const refuse = () => Errors.invalidCredentials()

    if (!admin) {
      await hashPassword(input.password)
      throw refuse()
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw Errors.accountLocked()
    }
    if (admin.status === 'SUSPENDED') throw Errors.accountSuspended()

    const passwordOk = await verifyPassword(admin.passwordHash, input.password)

    // The TOTP secret is checked even when the password was wrong, so the two factors
    // cannot be distinguished by response time.
    let totpOk = false
    if (admin.mfaSecret) {
      try {
        totpOk = verifyTotp(openSecret(admin.mfaSecret, this.encryptionKey), input.totpCode)
      } catch {
        totpOk = false
      }
    }

    // No secret at all means enrolment never started, so there is no second factor to
    // present and the account is unusable by design.
    if (!admin.mfaSecret) {
      await this.recordFailure(admin.id, 'mfa_not_enrolled')
      throw new DomainError(
        'UNAUTHENTICATED',
        'This account has no two-factor secret. Ask an administrator to re-issue it.',
        401,
      )
    }

    if (!passwordOk || !totpOk) {
      await this.recordFailure(admin.id, passwordOk ? 'bad_totp' : 'bad_password')
      throw refuse()
    }

    // First successful sign-in completes enrolment. The account was provisioned with a
    // secret the operator already holds, and they have just proved it by producing a
    // valid code — so requiring a separate confirmation step would only have created a
    // deadlock: confirming needs a session, and a session needs a completed enrolment.
    // Two factors were still both required to get here, which is the property that
    // matters (DECISIONS.md D-067).
    const justEnrolled = admin.status === 'PENDING_MFA'

    const token = generateToken(32)
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000)
    await this.prisma.raw.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashToken(token),
        ipHash: hashIp(input.ip, process.env.SESSION_SECRET ?? ''),
        userAgent: input.userAgent?.slice(0, 500) ?? null,
        expiresAt,
      },
    })
    await this.prisma.raw.adminUser.update({
      where: { id: admin.id },
      data: {
        lastLoginAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
        ...(justEnrolled ? { status: 'ACTIVE', mfaEnrolledAt: new Date() } : {}),
      },
    })
    if (justEnrolled) {
      await this.audit.record({
        actorType: 'ADMIN',
        actorAdminId: admin.id,
        action: 'admin.mfa_enrolled',
        resourceType: 'admin_user',
        resourceId: admin.id,
      })
    }

    await this.audit.record({
      actorType: 'ADMIN',
      actorAdminId: admin.id,
      action: 'admin.signed_in',
      resourceType: 'admin_user',
      resourceId: admin.id,
      metadata: { role: admin.role },
    })
    this.logger.log({ adminId: admin.id, role: admin.role }, 'admin signed in')

    return {
      token,
      expiresAt,
      admin: { id: admin.id, email: admin.email, role: admin.role as AdminRole },
    }
  }

  private async recordFailure(adminId: string, reason: string) {
    const updated = await this.prisma.raw.adminUser.update({
      where: { id: adminId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    })
    if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.prisma.raw.adminUser.update({
        where: { id: adminId },
        data: {
          lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          failedAttempts: 0,
        },
      })
    }
    await this.audit.record({
      actorType: 'ADMIN',
      actorAdminId: adminId,
      action: 'admin.sign_in_failed',
      resourceType: 'admin_user',
      resourceId: adminId,
      // The reason is recorded for investigation; never the password or the code.
      metadata: { reason },
    })
  }

  async resolveSession(token: string): Promise<AdminIdentity | null> {
    const session = await this.prisma.raw.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { adminUser: true },
    })
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null
    if (session.adminUser.status !== 'ACTIVE') return null

    // At most once every five minutes, to avoid a write per request.
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      await this.prisma.raw.adminSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
    }

    return {
      id: session.adminUser.id,
      email: session.adminUser.email,
      role: session.adminUser.role as AdminRole,
    }
  }

  async logout(token: string): Promise<void> {
    const hash = hashToken(token)
    const session = await this.prisma.raw.adminSession.findUnique({ where: { tokenHash: hash } })
    if (!session) return
    await this.prisma.raw.adminSession.update({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    })
    await this.audit.record({
      actorType: 'ADMIN',
      actorAdminId: session.adminUserId,
      action: 'admin.signed_out',
      resourceType: 'admin_user',
      resourceId: session.adminUserId,
    })
  }

  /**
   * Begins 2FA enrolment: generates a secret, stores it sealed, and returns the URI once.
   * The account stays PENDING_MFA — and unusable — until a code is confirmed.
   */
  async beginEnrolment(adminId: string): Promise<{ secret: string; uri: string }> {
    const admin = await this.prisma.raw.adminUser.findUnique({ where: { id: adminId } })
    if (!admin) throw Errors.notFound('Admin user')
    if (admin.mfaEnrolledAt) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'Two-factor authentication is already set up for this account.',
        422,
      )
    }

    const secret = generateTotpSecret()
    await this.prisma.raw.adminUser.update({
      where: { id: adminId },
      data: { mfaSecret: sealSecret(secret, this.encryptionKey) },
    })
    return {
      secret,
      uri: totpUri({ secret, account: admin.email, issuer: 'AutoServices Admin' }),
    }
  }

  /** Confirms enrolment with a working code, which is what activates the account. */
  async confirmEnrolment(adminId: string, code: string): Promise<void> {
    const admin = await this.prisma.raw.adminUser.findUnique({ where: { id: adminId } })
    if (!admin?.mfaSecret) throw Errors.notFound('Enrolment')

    if (!verifyTotp(openSecret(admin.mfaSecret, this.encryptionKey), code)) {
      throw new DomainError('VALIDATION_FAILED', 'That code is not valid. Try the next one.', 422)
    }

    await this.prisma.raw.adminUser.update({
      where: { id: adminId },
      data: { mfaEnrolledAt: new Date(), status: 'ACTIVE' },
    })
    await this.audit.record({
      actorType: 'ADMIN',
      actorAdminId: adminId,
      action: 'admin.mfa_enrolled',
      resourceType: 'admin_user',
      resourceId: adminId,
    })
  }
}
