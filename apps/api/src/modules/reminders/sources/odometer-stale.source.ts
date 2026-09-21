import { Injectable } from '@nestjs/common'
import { daysBetween, type CalendarDate } from '@autoservices/types'
import { PrismaService } from '../../../common/prisma.service.js'
import type { ReminderCandidate, ReminderSource, ScanContext } from '../reminder.types.js'

const STALE_DAYS = 45

/**
 * Stale-odometer source (task brief §31).
 *
 * Mileage-based reminders silently rot when the reading stops being updated: the engine
 * keeps projecting from an old number and the user believes it. Rather than let that
 * happen quietly, we ask for a reading.
 */
@Injectable()
export class OdometerStaleReminderSource implements ReminderSource {
  readonly type = 'ODOMETER_STALE' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)

    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        currentOdometerAt: true,
        currentOdometer: true,
      },
    })

    const out: ReminderCandidate[] = []
    for (const v of vehicles) {
      // Only nag when there is something to keep accurate: a vehicle with no
      // distance-based maintenance does not need its mileage chased.
      const hasDistanceRule = await db.maintenanceRule.count({
        where: { vehicleId: v.id, isActive: true, intervalDistance: { not: null } },
      })
      if (hasDistanceRule === 0) continue

      const recordedOn = v.currentOdometerAt
        ? (v.currentOdometerAt.toISOString().slice(0, 10) as CalendarDate)
        : null
      const age = recordedOn === null ? null : daysBetween(recordedOn, ctx.today)
      if (age !== null && age <= STALE_DAYS) continue

      const vehicleName = `${v.manufacturer} ${v.model}`
      out.push({
        sourceType: 'ODOMETER_STALE',
        sourceId: v.id,
        vehicleId: v.id,
        title: `${vehicleName}: update your mileage`,
        body:
          age === null
            ? 'No mileage recorded yet. Add a reading so maintenance reminders can be calculated.'
            : `Your mileage hasn't been updated for ${age} days. Update it to keep maintenance reminders accurate.`,
        // Deliberately date-less: this is a standing prompt, not a dated obligation.
        dueOn: ctx.today,
        dueOdometer: null,
        dueOdometerUnit: null,
        category: 'MAINTENANCE',
        actionPath: `/vehicles/${v.id}?tab=mileage`,
        alreadyOverdue: false,
        currentOdometer: v.currentOdometer,
      })
    }
    return out
  }
}
