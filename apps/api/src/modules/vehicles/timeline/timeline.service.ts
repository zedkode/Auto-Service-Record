import { Injectable } from '@nestjs/common'
import type { DistanceUnit } from '@autoservices/types'
import { PrismaService } from '../../../common/prisma.service.js'

/**
 * VEHICLE TIMELINE (task brief §20).
 *
 * ONE aggregator over many sources, not a timeline per feature. Adding inspections,
 * fuel, expenses or documents later means adding a collector below — the shape of an
 * event, the sorting and the rendering all stay put.
 */
export type TimelineEventType =
  | 'VEHICLE_ADDED'
  | 'PURCHASE'
  | 'SALE'
  | 'SERVICE'
  | 'ODOMETER'
  | 'INSPECTION'
  | 'INSURANCE'
  | 'TAX'
  | 'FUEL'
  | 'EXPENSE'
  | 'DOCUMENT'
  | 'NOTE'

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  /** Calendar date, YYYY-MM-DD. Timeline ordering is by when things HAPPENED. */
  occurredOn: string
  title: string
  description: string | null
  odometer: { value: number; unit: DistanceUnit } | null
  amount: { amount: string; currency: string } | null
  /** What this event points at, so the UI can link through. */
  refType: string
  refId: string
  meta?: Record<string, string | number | null>
}

const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async forVehicle(workspaceId: string, vehicleId: string, limit = 100): Promise<TimelineEvent[]> {
    const db = this.prisma.forWorkspace(workspaceId)

    const [vehicle, services, odometer] = await Promise.all([
      db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } }),
      db.serviceRecord.findMany({
        where: { vehicleId, deletedAt: null },
        include: { category: true },
        orderBy: { performedOn: 'desc' },
        take: limit,
      }),
      db.odometerEntry.findMany({
        where: { vehicleId },
        orderBy: [{ recordedOn: 'desc' }],
        take: limit,
      }),
    ])
    if (!vehicle) return []

    const events: TimelineEvent[] = []

    // --- services -------------------------------------------------------------------
    for (const s of services) {
      events.push({
        id: `service-${s.id}`,
        type: 'SERVICE',
        occurredOn: dateStr(s.performedOn)!,
        title: s.title,
        description: [s.category?.name, s.workshopName].filter(Boolean).join(' · ') || null,
        odometer:
          s.odometer !== null
            ? { value: s.odometer, unit: (s.odometerUnit ?? vehicle.distanceUnit) as DistanceUnit }
            : null,
        amount:
          s.totalAmount !== null
            ? { amount: s.totalAmount.toFixed(2), currency: s.currency }
            : null,
        refType: 'service_record',
        refId: s.id,
        meta: { category: s.category?.key ?? null },
      })
    }

    // --- odometer -------------------------------------------------------------------
    // A reading recorded BY a service is already represented by that service event;
    // showing both would double-report the same moment.
    const serviceIds = new Set(services.map((s) => s.id))
    for (const e of odometer) {
      if (e.source === 'SERVICE' && e.sourceRecordId && serviceIds.has(e.sourceRecordId)) continue
      events.push({
        id: `odo-${e.id}`,
        type: 'ODOMETER',
        occurredOn: dateStr(e.recordedOn)!,
        title: e.isCorrection ? 'Mileage corrected' : 'Mileage updated',
        description: e.correctionReason ?? e.notes ?? null,
        odometer: { value: e.value, unit: e.unit as DistanceUnit },
        amount: null,
        refType: 'odometer_entry',
        refId: e.id,
        meta: { source: e.source },
      })
    }

    // --- ownership ------------------------------------------------------------------
    if (vehicle.purchasedOn) {
      events.push({
        id: `purchase-${vehicle.id}`,
        type: 'PURCHASE',
        occurredOn: dateStr(vehicle.purchasedOn)!,
        title: 'Vehicle purchased',
        description: null,
        odometer:
          vehicle.purchaseOdometer !== null
            ? { value: vehicle.purchaseOdometer, unit: vehicle.distanceUnit as DistanceUnit }
            : null,
        amount:
          vehicle.purchasePrice !== null
            ? {
                amount: vehicle.purchasePrice.toFixed(2),
                currency: vehicle.purchaseCurrency ?? 'GBP',
              }
            : null,
        refType: 'vehicle',
        refId: vehicle.id,
      })
    }
    if (vehicle.soldOn) {
      events.push({
        id: `sale-${vehicle.id}`,
        type: 'SALE',
        occurredOn: dateStr(vehicle.soldOn)!,
        title: 'Vehicle sold',
        description: null,
        odometer: null,
        amount:
          vehicle.salePrice !== null
            ? { amount: vehicle.salePrice.toFixed(2), currency: vehicle.saleCurrency ?? 'GBP' }
            : null,
        refType: 'vehicle',
        refId: vehicle.id,
      })
    }

    events.push({
      id: `added-${vehicle.id}`,
      type: 'VEHICLE_ADDED',
      occurredOn: dateStr(vehicle.createdAt)!,
      title: 'Added to your garage',
      description: null,
      odometer: null,
      amount: null,
      refType: 'vehicle',
      refId: vehicle.id,
    })

    // Newest first; ties broken so the same day reads sensibly rather than at random.
    const typeWeight: Record<string, number> = {
      SERVICE: 0,
      INSPECTION: 1,
      PURCHASE: 2,
      SALE: 2,
      ODOMETER: 3,
      VEHICLE_ADDED: 9,
    }
    events.sort((a, b) => {
      if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1
      return (typeWeight[a.type] ?? 5) - (typeWeight[b.type] ?? 5)
    })

    return events.slice(0, limit)
  }
}
