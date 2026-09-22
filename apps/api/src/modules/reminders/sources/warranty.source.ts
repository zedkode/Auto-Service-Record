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
 * The rule the other expiry sources follow holds here too: only the record that currently
 * protects the vehicle is worth a reminder. A car with four expired warranties in its
 * history must not generate four notifications about cover that ran out years ago.
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

    /**
     * The best cover per vehicle, judged by the ENGINE rather than by expiry date. A
     * warranty with a later date but no mileage left is not better cover than one that
     * still has both, and sorting on the date alone would pick the wrong record.
     */
    const best = new Map<string, { row: (typeof rows)[number]; rank: number }>()
    const RANK: Record<string, number> = {
      ACTIVE: 4,
      EXPIRING_SOON: 3,
      NOT_STARTED: 2,
      UNKNOWN: 1,
      EXPIRED: 0,
    }

    for (const row of rows) {
      const status = this.statusOf(row, ctx.today)
      const rank = RANK[status.state] ?? 0
      const held = best.get(row.vehicleId)
      if (!held || rank > held.rank) best.set(row.vehicleId, { row, rank })
    }

    const out: ReminderCandidate[] = []
    for (const { row } of best.values()) {
      const status = this.statusOf(row, ctx.today)
      if (status.state !== 'EXPIRING_SOON' && status.state !== 'EXPIRED') continue

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

  private statusOf(
    row: {
      warrantyType: string
      startsOn: Date
      expiresOn: Date | null
      distanceLimit: number | null
      distanceLimitUnit: 'MILES' | 'KILOMETERS' | null
      startOdometer: number | null
      startOdometerUnit: 'MILES' | 'KILOMETERS' | null
      vehicle: { currentOdometer: number | null; currentOdometerUnit: 'MILES' | 'KILOMETERS' | null }
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

const LABEL: Record<WarrantyType, string> = {
  MANUFACTURER: 'Manufacturer warranty',
  DEALER: 'Dealer warranty',
  THIRD_PARTY: 'Warranty',
  PART: 'Part warranty',
  REPAIR: 'Repair guarantee',
}
