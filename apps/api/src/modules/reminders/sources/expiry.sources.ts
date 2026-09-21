import { Injectable } from '@nestjs/common'
import { daysBetween, type CalendarDate } from '@autoservices/types'
import { PrismaService } from '../../../common/prisma.service.js'
import type { ReminderCandidate, ReminderSource, ScanContext } from '../reminder.types.js'

/**
 * Expiry-driven reminder sources: inspection (MOT), insurance and road tax.
 *
 * All three answer the same question — "is this vehicle still legal to drive?" — and
 * share one rule that matters more than the date maths:
 *
 * **Only the record that currently protects the vehicle is a candidate.** A vehicle with
 * eight years of MOT history has eight expired certificates, and naively emitting each
 * one would bury the owner in reminders about obligations they met years ago. So each
 * source takes the row with the furthest-future expiry per vehicle and ignores the rest.
 *
 * A record with no expiry date is not an obligation and is skipped entirely.
 */

/** Far enough ahead to act on a renewal, close enough to stay meaningful. */
export const HORIZON_DAYS = 90

const dateStr = (d: Date) => d.toISOString().slice(0, 10) as CalendarDate

/** Picks, per vehicle, the row whose cover lasts longest. Exported for testing. */
export function latestPerVehicle<T extends { vehicleId: string; expiresOn: Date | null }>(
  rows: T[],
): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    if (!row.expiresOn) continue
    const current = best.get(row.vehicleId)
    if (!current || !current.expiresOn || row.expiresOn > current.expiresOn) {
      best.set(row.vehicleId, row)
    }
  }
  return [...best.values()]
}

export function withinHorizon(expiresOn: Date, today: CalendarDate): boolean {
  const remaining = daysBetween(today, dateStr(expiresOn))
  return remaining <= HORIZON_DAYS
}

const vehicleSelect = {
  id: true,
  manufacturer: true,
  model: true,
  registrationNumber: true,
  deletedAt: true,
  status: true,
} as const

type VehicleRef = {
  manufacturer: string
  model: string
  registrationNumber: string | null
}
const nameOf = (v: VehicleRef) => `${v.manufacturer} ${v.model}`

@Injectable()
export class InspectionReminderSource implements ReminderSource {
  readonly type = 'INSPECTION' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)
    const rows = await db.vehicleInspection.findMany({
      where: {
        deletedAt: null,
        expiresOn: { not: null },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { vehicle: { select: vehicleSelect } },
    })

    const out: ReminderCandidate[] = []
    for (const row of latestPerVehicle(rows)) {
      if (!row.expiresOn || !withinHorizon(row.expiresOn, ctx.today)) continue
      const expires = dateStr(row.expiresOn)
      const overdue = expires < ctx.today
      const label = row.inspectionType === 'OTHER' ? 'Inspection' : row.inspectionType
      out.push({
        sourceType: 'INSPECTION',
        sourceId: row.id,
        vehicleId: row.vehicleId,
        title: `${nameOf(row.vehicle)}: ${label} ${overdue ? 'has expired' : 'expires soon'}`,
        body: overdue
          ? `The ${label} expired on ${expires}. Driving without a valid certificate is an offence in most countries.`
          : `The ${label} expires on ${expires}. Book the retest before then to avoid being off the road.`,
        dueOn: expires,
        dueOdometer: null,
        dueOdometerUnit: null,
        category: 'INSPECTION',
        actionPath: `/vehicles/${row.vehicleId}?tab=ownership`,
        alreadyOverdue: overdue,
      })
    }
    return out
  }
}

@Injectable()
export class InsuranceReminderSource implements ReminderSource {
  readonly type = 'INSURANCE' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)
    const rows = await db.insurancePolicy.findMany({
      where: {
        deletedAt: null,
        expiresOn: { not: null },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { vehicle: { select: vehicleSelect } },
    })

    const out: ReminderCandidate[] = []
    for (const row of latestPerVehicle(rows)) {
      if (!row.expiresOn || !withinHorizon(row.expiresOn, ctx.today)) continue
      const expires = dateStr(row.expiresOn)
      const overdue = expires < ctx.today
      // An auto-renewing policy still warrants a heads-up — that is when the premium
      // changes — but it is not the emergency an expiring manual policy is.
      const auto = row.renewalType === 'AUTOMATIC'
      out.push({
        sourceType: 'INSURANCE',
        sourceId: row.id,
        vehicleId: row.vehicleId,
        title: `${nameOf(row.vehicle)}: insurance ${overdue ? 'has expired' : auto ? 'renews soon' : 'expires soon'}`,
        body: overdue
          ? `Cover from ${row.providerName} ended on ${expires}. Driving uninsured is an offence — renew before using the vehicle.`
          : auto
            ? `Your ${row.providerName} policy renews automatically on ${expires}. Check the new premium before it is taken.`
            : `Cover from ${row.providerName} ends on ${expires}. Arrange renewal to stay insured.`,
        dueOn: expires,
        dueOdometer: null,
        dueOdometerUnit: null,
        category: 'INSURANCE',
        actionPath: `/vehicles/${row.vehicleId}?tab=ownership`,
        alreadyOverdue: overdue,
      })
    }
    return out
  }
}

@Injectable()
export class RoadTaxReminderSource implements ReminderSource {
  readonly type = 'TAX' as const

  constructor(private readonly prisma: PrismaService) {}

  async scan(ctx: ScanContext): Promise<ReminderCandidate[]> {
    const db = this.prisma.forWorkspace(ctx.workspaceId)
    const rows = await db.roadTaxRecord.findMany({
      where: {
        deletedAt: null,
        expiresOn: { not: null },
        vehicle: { deletedAt: null, status: 'ACTIVE' },
      },
      include: { vehicle: { select: vehicleSelect } },
    })

    const out: ReminderCandidate[] = []
    for (const row of latestPerVehicle(rows)) {
      if (!row.expiresOn || !withinHorizon(row.expiresOn, ctx.today)) continue
      const expires = dateStr(row.expiresOn)
      const overdue = expires < ctx.today
      out.push({
        sourceType: 'TAX',
        sourceId: row.id,
        vehicleId: row.vehicleId,
        title: `${nameOf(row.vehicle)}: road tax ${overdue ? 'has expired' : 'expires soon'}`,
        body: overdue
          ? `Road tax expired on ${expires}. An untaxed vehicle can be penalised even when parked on a public road.`
          : `Road tax is due for renewal by ${expires}.`,
        dueOn: expires,
        dueOdometer: null,
        dueOdometerUnit: null,
        category: 'TAX',
        actionPath: `/vehicles/${row.vehicleId}?tab=ownership`,
        alreadyOverdue: overdue,
      })
    }
    return out
  }
}
