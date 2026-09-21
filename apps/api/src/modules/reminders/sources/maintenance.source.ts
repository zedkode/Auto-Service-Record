import { Injectable } from '@nestjs/common'
import type { CalendarDate, DistanceUnit } from '@autoservices/types'
import { PrismaService } from '../../../common/prisma.service.js'
import type { ReminderCandidate, ReminderSource, ScanContext } from '../reminder.types.js'

/**
 * Maintenance reminder source (REM-003).
 *
 * Reads the due-state the maintenance engine already computed and persisted, so the scan
 * is an index seek rather than a re-evaluation of every rule.
 */
@Injectable()
export class MaintenanceReminderSource implements ReminderSource {
  readonly type = 'MAINTENANCE' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)

    const rules = await db.maintenanceRule.findMany({
      where: {
        isActive: true,
        status: { in: ['DUE_SOON', 'DUE', 'OVERDUE'] },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: {
        vehicle: {
          select: {
            id: true,
            manufacturer: true,
            model: true,
            registrationNumber: true,
            currentOdometer: true,
            currentOdometerUnit: true,
            distanceUnit: true,
          },
        },
      },
    })

    return rules.map((rule) => {
      const vehicleName = `${rule.vehicle.manufacturer} ${rule.vehicle.model}`
      const unit = (rule.intervalDistanceUnit ?? rule.vehicle.distanceUnit) as DistanceUnit
      return {
        sourceType: 'MAINTENANCE' as const,
        sourceId: rule.id,
        vehicleId: rule.vehicleId,
        // Specific beats generic: "Ford Mondeo: oil service" not "Maintenance due".
        title: `${vehicleName}: ${rule.name}`,
        body: null,
        dueOn: rule.nextDueOn ? (rule.nextDueOn.toISOString().slice(0, 10) as CalendarDate) : null,
        dueOdometer: rule.nextDueOdometer,
        dueOdometerUnit: rule.nextDueOdometer !== null ? unit : null,
        category: 'MAINTENANCE' as const,
        actionPath: `/vehicles/${rule.vehicleId}?tab=maintenance`,
        alreadyOverdue: rule.status === 'OVERDUE',
        currentOdometer: rule.vehicle.currentOdometer,
      }
    })
  }
}
