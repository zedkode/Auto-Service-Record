import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../common/prisma.service.js'
import {
  ADVISORY_TREAD_MM,
  LEGAL_MINIMUM_TREAD_MM,
  treadStatus,
  type DistanceUnit,
  type Installation,
} from '../../tyres/tyre.engine.js'
import type { ReminderCandidate, ReminderSource, ScanContext } from '../reminder.types.js'

/**
 * OWN-005 — tyre reminders, from measured tread only.
 *
 * The other sources fire on a date. This one fires on a measurement, and only on one that
 * somebody actually took: tread wear depends on the car, the roads, the pressures and the
 * driver far more than on distance, so there is no honest way to predict it. A product that
 * guessed a depth and raised "your tyres are illegal" would be inventing the one fact here
 * that carries a fine and a licence endorsement.
 *
 * Only the set currently ON the vehicle is considered. A stored winter set measured at
 * 2 mm last April is a note for the owner, not something to warn about today.
 */
@Injectable()
export class TyreReminderSource implements ReminderSource {
  readonly type = 'TYRE' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)
    const fitted = await db.tyreInstallation.findMany({
      where: {
        removedOn: null,
        treadDepthMm: { not: null },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
        tyreSet: { deletedAt: null },
      },
      include: {
        tyreSet: { select: { id: true, name: true } },
        vehicle: { select: { manufacturer: true, model: true } },
      },
    })

    const out: ReminderCandidate[] = []
    for (const row of fitted) {
      const installation: Installation = {
        installedOn: row.installedOn.toISOString().slice(0, 10),
        installedOdometer: row.installedOdometer,
        removedOn: null,
        removedOdometer: null,
        odometerUnit: row.odometerUnit as DistanceUnit,
        treadDepthMm: row.treadDepthMm === null ? null : Number(row.treadDepthMm),
        treadMeasuredOn: row.treadMeasuredOn
          ? row.treadMeasuredOn.toISOString().slice(0, 10)
          : null,
      }
      const status = treadStatus([installation], ctx.today)
      if (status.state !== 'ILLEGAL' && status.state !== 'REPLACE_SOON') continue

      const name = `${row.vehicle.manufacturer} ${row.vehicle.model}`
      const illegal = status.state === 'ILLEGAL'
      out.push({
        sourceType: 'TYRE',
        sourceId: row.tyreSetId,
        vehicleId: row.vehicleId,
        title: illegal
          ? `${name}: tyres are below the legal minimum`
          : `${name}: tyres are wearing out`,
        body: illegal
          ? `The last measurement of "${row.tyreSet.name}" was ${status.depthMm} mm, below the ` +
            `${LEGAL_MINIMUM_TREAD_MM} mm legal minimum. Driving on them risks a fine and ` +
            `penalty points per tyre, and the car will fail its next inspection.`
          : `"${row.tyreSet.name}" measured ${status.depthMm} mm. Wet braking degrades sharply ` +
            `below ${ADVISORY_TREAD_MM} mm, which is why replacement is usually advised well ` +
            `before the ${LEGAL_MINIMUM_TREAD_MM} mm legal limit.`,
        // There is no date at which tread runs out — it is a measurement, not a deadline.
        dueOn: null,
        dueOdometer: null,
        dueOdometerUnit: null,
        category: 'MAINTENANCE',
        actionPath: `/vehicles/${row.vehicleId}?tab=ownership`,
        alreadyOverdue: illegal,
      })
    }
    return out
  }
}
