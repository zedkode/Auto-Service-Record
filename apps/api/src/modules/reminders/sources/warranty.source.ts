import { Injectable } from '@nestjs/common'
import type { CalendarDate } from '@autoservices/types'
import { PrismaService } from '../../../common/prisma.service.js'
import { warrantyStatus, type WarrantyType } from '../../warranties/warranty.engine.js'
import type { ReminderCandidate, ReminderSource, ScanContext } from '../reminder.types.js'

/**
 * OWN-004 — warranty reminders.
 *
 * Unlike the other expiry sources, this one cannot decide from a date alone: a warranty
 * that runs out at 60,000 miles ends when the odometer says so, whatever the calendar
 * says. The state therefore comes from the same engine the API uses, against the vehicle's
 * current reading — one definition, so the reminder and the page can never disagree.
 *
 * The rule the other expiry sources follow does NOT hold here, and getting that wrong was
 * a modelling error worth recording. Inspections, policies and tax are the SAME obligation
 * renewed, so only the newest matters. Warranties are not: a manufacturer powertrain
 * warranty and a guarantee on a clutch are different cover, and a live clutch guarantee is
 * no reason to stay silent about the powertrain cover ending. Each warranty is judged on
 * its own.
 *
 * What stops a car with years of history nagging is AGE, not competition: a warranty that
 * ended long ago is history, not news.
 */
@Injectable()
export class WarrantyReminderSource implements ReminderSource {
  readonly type = 'WARRANTY' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)
    const rows = await db.warranty.findMany({
      where: { deletedAt: null, vehicle: { deletedAt: null, status: 'ACTIVE' } },
      include: {
        vehicle: {
          select: {
            manufacturer: true,
            model: true,
            currentOdometer: true,
            currentOdometerUnit: true,
          },
        },
      },
    })

    const out: ReminderCandidate[] = []
    for (const row of rows) {
      const status = this.statusOf(row, ctx.today)
      if (status.state !== 'EXPIRING_SOON' && !this.recentlyEnded(status)) continue

      const name = `${row.vehicle.manufacturer} ${row.vehicle.model}`
      const label = LABEL[row.warrantyType as WarrantyType] ?? 'Warranty'
      const expired = status.state === 'EXPIRED'
      const byMileage = status.governedBy === 'DISTANCE'

      out.push({
        sourceType: 'WARRANTY',
        sourceId: row.id,
        vehicleId: row.vehicleId,
        title: `${name}: ${label} ${expired ? 'has ended' : 'is ending'}`,
        body: this.body(label, status, expired, byMileage),
        // A warranty ending on mileage has no meaningful due DATE, so the engine is given
        // the expiry where one exists and nothing where the mileage governs.
        dueOn: row.expiresOn ? (row.expiresOn.toISOString().slice(0, 10) as CalendarDate) : null,
        dueOdometer: byMileage ? (row.vehicle.currentOdometer ?? null) : null,
        dueOdometerUnit: byMileage ? (row.vehicle.currentOdometerUnit ?? null) : null,
        category: 'WARRANTY',
        actionPath: `/vehicles/${row.vehicleId}?tab=ownership`,
        alreadyOverdue: expired,
        currentOdometer: row.vehicle.currentOdometer ?? null,
      })
    }
    return out
  }

  /**
   * Whether an ended warranty is still worth saying anything about.
   *
   * By date, the window is the same 90 days the other expiry sources use. By mileage there
   * is no date to age against — we only learn the limit was passed when a reading arrives —
   * so the window is the size of the overrun instead. Past either, the warranty is part of
   * the vehicle's history and not something to act on.
   */
  private recentlyEnded(status: ReturnType<typeof warrantyStatus>): boolean {
    if (status.state !== 'EXPIRED') return false
    if (status.governedBy === 'DISTANCE' && status.distanceRemaining !== null) {
      return Math.abs(status.distanceRemaining) <= RECENT_OVERRUN
    }
    return status.daysRemaining !== null && status.daysRemaining >= -RECENT_DAYS
  }

  private statusOf(
    row: {
      warrantyType: string
      startsOn: Date
      expiresOn: Date | null
      distanceLimit: number | null
      distanceLimitUnit: 'MILES' | 'KILOMETERS' | null
      startOdometer: number | null
      startOdometerUnit: 'MILES' | 'KILOMETERS' | null
      vehicle: {
        currentOdometer: number | null
        currentOdometerUnit: 'MILES' | 'KILOMETERS' | null
      }
    },
    today: CalendarDate,
  ) {
    return warrantyStatus(
      {
        warrantyType: row.warrantyType as WarrantyType,
        startsOn: row.startsOn.toISOString().slice(0, 10),
        expiresOn: row.expiresOn ? row.expiresOn.toISOString().slice(0, 10) : null,
        distanceLimit: row.distanceLimit,
        distanceLimitUnit: row.distanceLimitUnit,
        startOdometer: row.startOdometer,
        startOdometerUnit: row.startOdometerUnit,
      },
      {
        currentOdometer: row.vehicle.currentOdometer,
        currentOdometerUnit: row.vehicle.currentOdometerUnit,
      },
      today,
    )
  }

  private body(
    label: string,
    status: ReturnType<typeof warrantyStatus>,
    expired: boolean,
    byMileage: boolean,
  ): string {
    const unit = (u: string | null) => (u === 'KILOMETERS' ? 'km' : 'miles')
    if (byMileage && status.distanceRemaining !== null) {
      const left = Math.abs(status.distanceRemaining).toLocaleString()
      return expired
        ? `The ${label.toLowerCase()} mileage limit was passed ${left} ${unit(null)} ago. Cover has ended even though the expiry date has not been reached.`
        : `About ${left} ${unit(null)} of cover left. Book anything you want claimed before the limit is reached.`
    }
    if (status.daysRemaining !== null) {
      const days = Math.abs(status.daysRemaining)
      return expired
        ? `The ${label.toLowerCase()} ended ${days} day${days === 1 ? '' : 's'} ago.`
        : `${days} day${days === 1 ? '' : 's'} of cover left.`
    }
    return `The ${label.toLowerCase()} is ending.`
  }
}

/** How long after it ends a warranty is still news rather than history. */
const RECENT_DAYS = 90
/** And the mileage equivalent, in the limit's own unit. */
const RECENT_OVERRUN = 5_000

const LABEL: Record<WarrantyType, string> = {
  MANUFACTURER: 'Manufacturer warranty',
  DEALER: 'Dealer warranty',
  THIRD_PARTY: 'Warranty',
  PART: 'Part warranty',
  REPAIR: 'Repair guarantee',
}
