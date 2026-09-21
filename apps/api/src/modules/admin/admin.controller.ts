import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { EmailLog, EmailSuppressionStore } from '@autoservices/db'
import { PrismaService } from '../../common/prisma.service.js'
import { QueueService } from '../../common/queue/queue.service.js'
import { Public } from '../../common/decorators/index.js'
import { RequireAdmin } from '../../common/guards/admin-session.guard.js'
import { DomainError } from '../../common/errors.js'

/**
 * ADMIN-005 — operational endpoints, behind the staff realm (ADMIN-001).
 *
 * Every route declares an admin permission and is reachable only with an admin session
 * cookie, which requires a password AND a TOTP code. `@Public()` here exempts the route
 * from the CUSTOMER guard; it is not public in any ordinary sense.
 *
 * They expose OPERATIONAL data only: email delivery state, queue depth, counts. No
 * vehicle content, no documents, no personal data beyond the recipient address already
 * required to debug a delivery (SECURITY.md §13).
 */
@Controller('admin')
export class AdminController {
  private readonly emailLog: EmailLog
  private readonly suppressions: EmailSuppressionStore

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {
    this.emailLog = new EmailLog(prisma.raw)
    this.suppressions = new EmailSuppressionStore(prisma.raw)
  }

  @Public()
  @RequireAdmin('admin:email:read')
  @Get('emails')
  async emails(
    @Query('status') status?: string,
    @Query('recipient') recipient?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.emailLog.list({
      status,
      recipient,
      limit: limit ? Number(limit) : undefined,
    })
    return { data, meta: { total: data.length } }
  }

  @Public()
  @RequireAdmin('admin:email:read')
  @Get('emails/stats')
  async emailStats() {
    const grouped = await this.prisma.raw.emailMessage.groupBy({
      by: ['status'],
      _count: { _all: true },
    })
    const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]))
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0)
    const failed = (byStatus.FAILED ?? 0) + (byStatus.BOUNCED ?? 0) + (byStatus.COMPLAINED ?? 0)
    return {
      data: {
        total,
        byStatus,
        failureRatePercent: total === 0 ? 0 : Math.round((failed / total) * 1000) / 10,
      },
    }
  }

  @Public()
  @RequireAdmin('admin:email:read')
  @Get('suppressions')
  async suppressionList(@Query('includeReleased') includeReleased?: string) {
    const data = await this.suppressions.list({ includeReleased: includeReleased === 'true' })
    return { data, meta: { total: data.length, active: await this.suppressions.count() } }
  }

  /**
   * Lifts a suppression. Deliberately a write endpoint on an internal-only route: getting
   * an address wrongly suppressed back into service is a support action, and the
   * alternative is editing the table by hand in production.
   */
  @Public()
  @RequireAdmin('admin:email:manage')
  @Post('suppressions/release')
  async releaseSuppression(@Body() body: { email?: string }) {
    const email = (body?.email ?? '').trim()
    if (!email) {
      throw new DomainError('VALIDATION_FAILED', 'An email address is required.', 422)
    }
    const released = await this.suppressions.release(email, 'admin-console')
    await this.prisma.raw.auditLog.create({
      data: {
        actorType: 'ADMIN',
        action: released ? 'email.suppression_released' : 'email.suppression_release_noop',
        resourceType: 'email_suppression',
        metadata: { email },
      },
    })
    return { data: { released } }
  }

  @Public()
  @RequireAdmin('admin:queues:read')
  @Get('queues')
  async queues() {
    const names = [
      'emails',
      'notifications',
      'maintenance',
      'documents',
      'reports',
      'cleanup',
    ] as const
    const data = await Promise.all(
      names.map(async (name) => ({ name, counts: await this.queue.counts(name) })),
    )
    return { data }
  }

  @Public()
  @RequireAdmin('admin:metrics:read')
  @Get('metrics')
  async metrics() {
    const [users, workspaces, vehicles, services, reminders, notifications] = await Promise.all([
      this.prisma.raw.user.count({ where: { deletedAt: null } }),
      this.prisma.raw.workspace.count({ where: { deletedAt: null } }),
      this.prisma.raw.vehicle.count({ where: { deletedAt: null } }),
      this.prisma.raw.serviceRecord.count({ where: { deletedAt: null } }),
      this.prisma.raw.reminder.count({ where: { status: { in: ['SCHEDULED', 'DUE', 'SENT'] } } }),
      this.prisma.raw.notification.count({ where: { readAt: null } }),
    ])
    return {
      data: {
        users,
        workspaces,
        vehicles,
        services,
        activeReminders: reminders,
        unreadNotifications: notifications,
      },
    }
  }

  @Public()
  @RequireAdmin('admin:audit:read')
  @Get('audit')
  async audit(@Query('limit') limit?: string) {
    const rows = await this.prisma.raw.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit ? Number(limit) : 50, 200),
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        actorType: true,
        actorUserId: true,
        workspaceId: true,
        createdAt: true,
        metadata: true,
      },
    })
    return {
      data: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  }
}
