import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma.service.js'
import { Errors } from '../../common/errors.js'

/**
 * In-app notification centre (NOT-001).
 *
 * Notifications are per USER, not per workspace member, so the query is scoped by user id
 * and filtered to workspaces they still belong to.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    const rows = await this.prisma.raw.notification.findMany({
      where: {
        userId,
        ...(opts.unreadOnly ? { readAt: null } : {}),
        // Only workspaces the user is still an active member of.
        workspace: { members: { some: { userId, status: 'ACTIVE' } } },
      },
      include: {
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 100),
    })

    return rows.map((n) => ({
      id: n.id,
      category: n.category,
      title: n.title,
      body: n.body,
      actionUrl: n.actionUrl,
      vehicleId: n.vehicleId,
      reminderId: n.reminderId,
      workspace: n.workspace,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }))
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.raw.notification.count({
      where: {
        userId,
        readAt: null,
        workspace: { members: { some: { userId, status: 'ACTIVE' } } },
      },
    })
  }

  async markRead(userId: string, notificationId: string) {
    // Scoped by userId as well as id: one user must not be able to mark another's
    // notification read by guessing an id.
    const updated = await this.prisma.raw.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    })
    if (updated.count === 0) {
      const exists = await this.prisma.raw.notification.findFirst({
        where: { id: notificationId, userId },
      })
      if (!exists) throw Errors.notFound('Notification')
    }
    return { ok: true }
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.raw.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { marked: count }
  }

  /** Per-category, per-channel preferences for one workspace. */
  async preferences(userId: string, workspaceId: string) {
    const rows = await this.prisma.raw.notificationPreference.findMany({
      where: { userId, workspaceId },
    })
    const map = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.isEnabled]))

    const categories = [
      'MAINTENANCE',
      'INSPECTION',
      'INSURANCE',
      'TAX',
      'WARRANTY',
      'DOCUMENT',
      'DIGEST',
    ] as const

    return categories.map((category) => ({
      category,
      // Absent means enabled: reminders are opt-out. DIGEST is the exception — it is
      // opt-in, because nobody asked for a weekly summary by signing up.
      email: map.get(`${category}:EMAIL`) ?? category !== 'DIGEST',
      inApp: map.get(`${category}:IN_APP`) ?? category !== 'DIGEST',
    }))
  }

  async setPreference(
    userId: string,
    workspaceId: string,
    category: string,
    channel: string,
    isEnabled: boolean,
  ) {
    await this.prisma.raw.notificationPreference.upsert({
      where: {
        userId_workspaceId_category_channel: {
          userId,
          workspaceId,
          category: category as never,
          channel: channel as never,
        },
      },
      create: {
        userId,
        workspaceId,
        category: category as never,
        channel: channel as never,
        isEnabled,
      },
      update: { isEnabled },
    })
    return this.preferences(userId, workspaceId)
  }
}
