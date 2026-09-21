import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { calendarDate, daysBetween, type CalendarDate } from '@autoservices/types'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { QueueService } from '../../common/queue/queue.service.js'
import { Errors } from '../../common/errors.js'
import { MaintenanceReminderSource } from './sources/maintenance.source.js'
import { OdometerStaleReminderSource } from './sources/odometer-stale.source.js'
import {
  InspectionReminderSource,
  InsuranceReminderSource,
  RoadTaxReminderSource,
} from './sources/expiry.sources.js'
import { deliveryKey, evaluateDateWindow, evaluateDistanceWindow } from './reminder.policy.js'
import type { ReminderCandidate, ReminderSource } from './reminder.types.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined): CalendarDate | null =>
  d ? (d.toISOString().slice(0, 10) as CalendarDate) : null
const today = (): CalendarDate => calendarDate(new Date().toISOString().slice(0, 10))

export interface ScanResult {
  scanned: number
  created: number
  updated: number
  notified: number
  emailsQueued: number
  skippedDuplicate: number
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger('RemindersService')
  private readonly sources: ReminderSource[]

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    maintenanceSource: MaintenanceReminderSource,
    odometerSource: OdometerStaleReminderSource,
    inspectionSource: InspectionReminderSource,
    insuranceSource: InsuranceReminderSource,
    roadTaxSource: RoadTaxReminderSource,
  ) {
    // Registering a source is the ONLY change needed to add inspections, insurance or
    // tax reminders later. The engine below is source-agnostic.
    this.sources = [
      maintenanceSource,
      odometerSource,
      inspectionSource,
      insuranceSource,
      roadTaxSource,
    ]
  }

  // -------------------------------------------------------------------------
  // The engine
  // -------------------------------------------------------------------------

  /**
   * Scans every registered source for one workspace, upserts reminders, transitions
   * those that have entered a notification window, and dispatches notifications.
   *
   * Safe to run repeatedly: the delivery ledger's unique key makes a repeat a no-op.
   */
  async scanWorkspace(workspaceId: string, appUrl: string): Promise<ScanResult> {
    const result: ScanResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      notified: 0,
      emailsQueued: 0,
      skippedDuplicate: 0,
    }
    const now = today()
    const db = this.prisma.forWorkspace(workspaceId)

    for (const source of this.sources) {
      let candidates: ReminderCandidate[]
      try {
        candidates = await source.scan({ workspaceId, today: now })
      } catch (err) {
        // One broken source must not stop the others; a silent failure here would mean
        // users simply stop being told things.
        this.logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            source: source.type,
            workspaceId,
          },
          'reminder source failed',
        )
        continue
      }
      result.scanned += candidates.length

      for (const c of candidates) {
        const existing = await db.reminder.findFirst({
          where: {
            sourceType: c.sourceType,
            sourceId: c.sourceId,
            status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] },
          },
        })

        const reminder = existing
          ? await db.reminder.update({
              where: { id: existing.id },
              data: {
                title: c.title,
                body: c.body,
                dueOn: c.dueOn ? toDateOnly(c.dueOn) : null,
                dueOdometer: c.dueOdometer,
                dueOdometerUnit: c.dueOdometerUnit,
                vehicleId: c.vehicleId,
                lastEvaluatedAt: new Date(),
              },
            })
          : await db.reminder.create({
              data: {
                workspaceId,
                vehicleId: c.vehicleId,
                sourceType: c.sourceType,
                sourceId: c.sourceId,
                title: c.title,
                body: c.body,
                dueOn: c.dueOn ? toDateOnly(c.dueOn) : null,
                dueOdometer: c.dueOdometer,
                dueOdometerUnit: c.dueOdometerUnit,
                lastEvaluatedAt: new Date(),
              },
            })
        if (existing) result.updated++
        else result.created++

        // A snoozed reminder stays quiet until its snooze elapses.
        if (reminder.status === 'SNOOZED') {
          const until = dateStr(reminder.snoozedUntil)
          if (until && until > now) continue
        }

        const decision = this.decideWindow(c, reminder.leadDays, reminder.leadDistances, now)
        if (!decision.windowKey) continue

        if (reminder.status === 'SCHEDULED' || reminder.status === 'SNOOZED') {
          await db.reminder.update({
            where: { id: reminder.id },
            data: { status: 'DUE', snoozedUntil: null },
          })
        }

        const dispatched = await this.dispatch(
          workspaceId,
          reminder.id,
          c,
          decision.windowKey,
          decision.phrase,
          decision.magnitude,
          appUrl,
          decision.overdue,
        )
        result.notified += dispatched.notified
        result.emailsQueued += dispatched.emailsQueued
        result.skippedDuplicate += dispatched.skipped
      }
    }

    return result
  }

  /** Date and distance windows combined: whichever is more urgent wins. */
  private decideWindow(
    c: ReminderCandidate,
    leadDays: number[],
    leadDistances: number[],
    now: CalendarDate,
  ) {
    const unitLabel = c.dueOdometerUnit === 'KILOMETERS' ? 'km' : 'miles'

    const dateDecision = c.dueOn ? evaluateDateWindow(c.dueOn, now, leadDays) : null
    const distanceDecision =
      c.dueOdometer !== null && c.currentOdometer !== null && c.currentOdometer !== undefined
        ? evaluateDistanceWindow(c.dueOdometer, c.currentOdometer, unitLabel, leadDistances, now)
        : null

    // Overdue beats approaching; otherwise whichever has actually opened a window.
    if (distanceDecision?.overdue) return distanceDecision
    if (dateDecision?.overdue) return dateDecision
    if (distanceDecision?.windowKey) return distanceDecision
    if (dateDecision?.windowKey) return dateDecision

    // A source can assert overdue-ness the date maths cannot see.
    if (c.alreadyOverdue) {
      return { windowKey: `overdue-${now}`, overdue: true, phrase: 'now', magnitude: 'now' }
    }
    return { windowKey: null, overdue: false, phrase: '', magnitude: '' }
  }

  /**
   * Fan-out. In-app first (immediate and free), then email via the queue.
   * Every delivery is reserved in the ledger before it happens (EMAILS.md §4).
   */
  private async dispatch(
    workspaceId: string,
    reminderId: string,
    c: ReminderCandidate,
    windowKey: string,
    phrase: string,
    magnitude: string,
    appUrl: string,
    overdue: boolean,
  ): Promise<{ notified: number; emailsQueued: number; skipped: number }> {
    const recipients = await this.recipients(workspaceId)
    let notified = 0
    let emailsQueued = 0
    let skipped = 0

    // "Overdue by 3 days" and "Due in 3 days" are different sentences; reusing one
    // phrasing for both produced "due in ... ago".
    // `magnitude` carries no direction, so the preposition here reads correctly.
    // Using `phrase` produced "Overdue by 23,200 miles ago."
    const body = c.body ?? (overdue ? `Overdue by ${magnitude}.` : `Due ${phrase}.`)

    for (const user of recipients) {
      // --- in-app ---------------------------------------------------------
      const inAppKey = deliveryKey({
        workspaceId,
        reminderId,
        channel: 'IN_APP',
        userId: user.id,
        windowKey,
      })
      const inApp = await this.reserve(workspaceId, reminderId, user.id, 'IN_APP', inAppKey)
      if (inApp) {
        await this.prisma.raw.notification.create({
          data: {
            workspaceId,
            userId: user.id,
            category: c.category,
            title: c.title,
            body,
            actionUrl: c.actionPath,
            vehicleId: c.vehicleId,
            reminderId,
          },
        })
        await this.prisma.raw.notificationDelivery.update({
          where: { idempotencyKey: inAppKey },
          data: { status: 'SENT', deliveredAt: new Date() },
        })
        notified++
      } else {
        skipped++
      }

      // --- email ----------------------------------------------------------
      if (!(await this.wantsEmail(user.id, workspaceId, c.category))) continue

      const emailKey = deliveryKey({
        workspaceId,
        reminderId,
        channel: 'EMAIL',
        userId: user.id,
        windowKey,
      })
      const email = await this.reserve(workspaceId, reminderId, user.id, 'EMAIL', emailKey)
      if (!email) {
        skipped++
        continue
      }

      const queued = await this.queue.sendEmail({
        template:
          c.sourceType === 'ODOMETER_STALE'
            ? 'odometer-stale'
            : overdue
              ? 'service-overdue'
              : 'service-due',
        to: user.email,
        category: c.category,
        idempotencyKey: emailKey,
        userId: user.id,
        workspaceId,
        props: {
          vehicleName: c.title.split(':')[0] ?? c.title,
          itemName: c.title.split(':').slice(1).join(':').trim() || c.title,
          dueIn: phrase,
          overdueBy: magnitude,
          body,
          url: `${appUrl}${c.actionPath}`,
        },
      })

      if (queued) {
        emailsQueued++
      } else {
        // The reservation must not outlive a failed enqueue, or this window can never
        // be retried and the user simply never hears about it.
        await this.prisma.raw.notificationDelivery.deleteMany({
          where: { idempotencyKey: emailKey },
        })
        this.logger.warn(
          { reminderId, userId: user.id, windowKey },
          'released email reservation after a failed enqueue',
        )
      }
    }

    await this.prisma.raw.reminder.updateMany({
      where: { id: reminderId, status: 'DUE' },
      data: { status: 'SENT' },
    })

    return { notified, emailsQueued, skipped }
  }

  /**
   * Reserves a delivery slot. Returns false when this exact delivery already happened —
   * the unique constraint is the arbiter, so concurrent workers cannot both win.
   */
  private async reserve(
    workspaceId: string,
    reminderId: string,
    userId: string,
    channel: 'IN_APP' | 'EMAIL',
    key: string,
  ): Promise<boolean> {
    try {
      await this.prisma.raw.notificationDelivery.create({
        data: { workspaceId, reminderId, userId, channel, idempotencyKey: key },
      })
      return true
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false
      }
      throw err
    }
  }

  /** Active members of the workspace. */
  private async recipients(workspaceId: string) {
    const members = await this.prisma.raw.workspaceMember.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      include: { user: { select: { id: true, email: true, deletedAt: true } } },
    })
    return members
      .filter((m) => !m.user.deletedAt)
      .map((m) => ({ id: m.user.id, email: m.user.email }))
  }

  /** Preference lookup. Absent row means enabled — reminders are opt-out, not opt-in. */
  private async wantsEmail(
    userId: string,
    workspaceId: string,
    category: string,
  ): Promise<boolean> {
    const pref = await this.prisma.raw.notificationPreference.findFirst({
      where: { userId, workspaceId, category: category as never, channel: 'EMAIL' },
    })
    return pref?.isEnabled ?? true
  }

  // -------------------------------------------------------------------------
  // User-facing operations
  // -------------------------------------------------------------------------

  async list(workspaceId: string, filter?: 'active' | 'all') {
    const db = this.prisma.forWorkspace(workspaceId)
    const reminders = await db.reminder.findMany({
      where: filter === 'all' ? {} : { status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] } },
      include: {
        vehicle: {
          select: { id: true, manufacturer: true, model: true, registrationNumber: true },
        },
      },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    })

    const now = today()
    const soonBoundary = addDays(now, 30)

    return reminders.map((r) => {
      const due = dateStr(r.dueOn)
      const overdue = due !== null && due < now && ['DUE', 'SENT', 'SCHEDULED'].includes(r.status)
      const daysRemaining = due === null ? null : daysBetween(now, due)

      // Bucketing and day counts are computed here, not in the browser: the client
      // rendering a date calculation makes render impure and puts a business rule in
      // the UI (CLAUDE.md).
      const bucket: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'HANDLED' = [
        'COMPLETED',
        'DISMISSED',
        'CANCELLED',
      ].includes(r.status)
        ? 'HANDLED'
        : overdue
          ? 'OVERDUE'
          : due !== null && due <= soonBoundary
            ? 'DUE_SOON'
            : 'UPCOMING'

      return {
        bucket,
        daysRemaining,
        id: r.id,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        vehicle: r.vehicle,
        title: r.title,
        body: r.body,
        dueOn: due,
        dueOdometer: r.dueOdometer,
        dueOdometerUnit: r.dueOdometerUnit,
        status: r.status,
        snoozedUntil: dateStr(r.snoozedUntil),
        overdue,
        actionUrl: r.vehicleId ? `/vehicles/${r.vehicleId}` : null,
      }
    })
  }

  async snooze(workspaceId: string, reminderId: string, userId: string, until: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const reminder = await db.reminder.findFirst({ where: { id: reminderId } })
    if (!reminder) throw Errors.notFound('Reminder')

    await db.reminder.update({
      where: { id: reminderId },
      data: { status: 'SNOOZED', snoozedUntil: toDateOnly(until) },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'reminder.snoozed',
      resourceType: 'reminder',
      resourceId: reminderId,
      metadata: { until },
    })
    return this.getOne(workspaceId, reminderId)
  }

  async dismiss(workspaceId: string, reminderId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const reminder = await db.reminder.findFirst({ where: { id: reminderId } })
    if (!reminder) throw Errors.notFound('Reminder')

    await db.reminder.update({
      where: { id: reminderId },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'reminder.dismissed',
      resourceType: 'reminder',
      resourceId: reminderId,
    })
  }

  async complete(workspaceId: string, reminderId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const reminder = await db.reminder.findFirst({ where: { id: reminderId } })
    if (!reminder) throw Errors.notFound('Reminder')

    await db.reminder.update({
      where: { id: reminderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'reminder.completed',
      resourceType: 'reminder',
      resourceId: reminderId,
    })
  }

  async getOne(workspaceId: string, reminderId: string) {
    const all = await this.list(workspaceId, 'all')
    const found = all.find((r) => r.id === reminderId)
    if (!found) throw Errors.notFound('Reminder')
    return found
  }

  /** Counts for the dashboard and the sidebar badge. */
  async summary(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const active = await db.reminder.findMany({
      where: { status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] } },
      select: { dueOn: true, status: true },
    })
    const now = today()
    let overdue = 0
    let dueSoon = 0
    for (const r of active) {
      const due = dateStr(r.dueOn)
      if (due === null) continue
      if (due < now) overdue++
      else if (due <= addDays(now, 30)) dueSoon++
    }
    return { total: active.length, overdue, dueSoon }
  }
}

function addDays(d: CalendarDate, n: number): CalendarDate {
  const dt = new Date(`${d}T00:00:00.000Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10) as CalendarDate
}
