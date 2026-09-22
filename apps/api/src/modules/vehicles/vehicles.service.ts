import { Injectable } from '@nestjs/common'
import type { Prisma, OdometerEntry, Vehicle } from '@prisma/client'
import type {
  CreateVehicleInput,
  VehicleStatusValue,
  CreateOdometerEntryInput,
} from '@autoservices/validation'
import { compareDistance, type Distance, type DistanceUnit } from '@autoservices/types'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import { TimelineService } from './timeline/timeline.service.js'

/** How stale a reading may be before distance-based projections stop being trustworthy. */
const ODOMETER_STALE_DAYS = 45

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateOnlyString = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timelineService: TimelineService,
  ) {}

  /**
   * Vehicles still in use. A sold or archived vehicle is deliberately absent unless asked
   * for: the garage view is about what you drive, and its history stays readable through
   * the vehicle itself (DATABASE.md §5).
   */
  async list(workspaceId: string, options: { includeInactive?: boolean } = {}) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicles = await db.vehicle.findMany({
      where: {
        deletedAt: null,
        ...(options.includeInactive ? {} : { status: { notIn: ['SOLD', 'SCRAPPED', 'ARCHIVED'] } }),
      },
      orderBy: { createdAt: 'desc' },
    })
    return vehicles.map((v: Vehicle) => this.toSummary(v))
  }

  /**
   * Moves a vehicle through its lifecycle. Nothing is removed: selling a car keeps every
   * service, fill and certificate exactly where it was, which is most of why someone kept
   * the record at all.
   *
   * Leaving ACTIVE also cancels open reminders. The reminder sources already stop
   * *emitting* for a non-active vehicle, but a reminder already raised would otherwise sit
   * there telling the previous owner their sold car needs an MOT (the same defect D-052
   * fixed for renewals).
   */
  async changeStatus(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    input: { status: VehicleStatusValue; reason?: string },
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    if (vehicle.status === input.status) return this.toDetail(vehicle)

    const updated = await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      const next = await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: input.status },
      })
      if (input.status !== 'ACTIVE') {
        await tx.reminder.updateMany({
          where: {
            workspaceId,
            vehicleId,
            status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] },
          },
          data: { status: 'CANCELLED' },
        })
      }
      return next
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'vehicle.status_changed',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: { from: vehicle.status, to: input.status, reason: input.reason ?? null },
    })
    return this.toDetail(updated)
  }

  /**
   * Soft delete: "entered in error", hidden everywhere, recoverable.
   *
   * A vehicle is NEVER hard-deleted by a user action (DATABASE.md §5 rule 1). The history
   * rows are left exactly as they are, so restoring brings back a complete record rather
   * than an empty shell.
   */
  async softDelete(workspaceId: string, vehicleId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { deletedAt: new Date() },
      })
      await tx.reminder.updateMany({
        where: {
          workspaceId,
          vehicleId,
          status: { in: ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'] },
        },
        data: { status: 'CANCELLED' },
      })
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'vehicle.deleted',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: {
        soft: true,
        registrationNumber: vehicle.registrationNumber,
        // Recorded so the audit trail can say what was hidden, and for how long.
        status: vehicle.status,
      },
    })
  }

  /** Brings back a vehicle deleted in error, with its history intact. */
  async restore(workspaceId: string, vehicleId: string, userId: string) {
    // The tenant client scopes by workspace; the row is found despite being deleted,
    // which is the one place a deleted vehicle must still be reachable.
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: { not: null } },
    })
    if (!vehicle) throw Errors.vehicleNotFound()

    /**
     * The registration uniqueness index is partial (`WHERE deleted_at IS NULL`), so
     * deleting a vehicle frees its plate — deliberately, since the usual reason to delete
     * one is that it was entered wrongly. That leaves one collision: the plate was reused
     * while this vehicle was hidden, and clearing `deleted_at` would now put two live rows
     * on the same registration. Postgres rejects it either way; without this check the
     * user gets a 500 instead of being told what happened.
     */
    if (vehicle.registrationNumber) {
      const clash = await db.vehicle.findFirst({
        where: {
          registrationNumber: vehicle.registrationNumber,
          deletedAt: null,
          id: { not: vehicleId },
        },
      })
      if (clash) throw Errors.registrationReused(vehicle.registrationNumber)
    }

    const restored = await db.vehicle.update({
      where: { id: vehicleId },
      data: { deletedAt: null },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'vehicle.restored',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: { registrationNumber: vehicle.registrationNumber },
    })
    return this.toDetail(restored)
  }

  /** Vehicles hidden by a soft delete, so one deleted in error can be found again. */
  async listDeleted(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    })
    return vehicles.map((v: Vehicle) => ({
      ...this.toSummary(v),
      deletedAt: v.deletedAt?.toISOString() ?? null,
    }))
  }

  async get(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()
    return this.toDetail(vehicle)
  }

  async create(workspaceId: string, userId: string, input: CreateVehicleInput) {
    const db = this.prisma.forWorkspace(workspaceId)

    if (input.registrationNumber) {
      const clash = await db.vehicle.findFirst({
        where: { registrationNumber: input.registrationNumber, deletedAt: null },
      })
      if (clash) throw Errors.duplicateRegistration(input.registrationNumber)
    }

    const { currentOdometer, ...vehicleData } = input

    // One transaction: the vehicle and its first mileage reading are a single fact.
    const vehicle = await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.vehicle.create({
        data: {
          ...vehicleData,
          workspaceId,
          firstRegisteredOn: input.firstRegisteredOn ? toDateOnly(input.firstRegisteredOn) : null,
          purchasedOn: input.purchasedOn ? toDateOnly(input.purchasedOn) : null,
          ...(currentOdometer !== undefined
            ? {
                currentOdometer,
                currentOdometerUnit: input.distanceUnit,
                currentOdometerAt: new Date(new Date().toISOString().slice(0, 10)),
              }
            : {}),
        },
      })

      if (currentOdometer !== undefined) {
        await tx.odometerEntry.create({
          data: {
            workspaceId,
            vehicleId: created.id,
            value: currentOdometer,
            unit: input.distanceUnit,
            recordedOn: new Date(new Date().toISOString().slice(0, 10)),
            source: 'MANUAL',
            createdByUserId: userId,
            notes: 'Initial reading recorded when the vehicle was added',
          },
        })
      }
      return created
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'vehicle.created',
      resourceType: 'vehicle',
      resourceId: vehicle.id,
      metadata: { manufacturer: vehicle.manufacturer, model: vehicle.model },
    })

    return this.toDetail(vehicle)
  }

  async listOdometer(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const entries = await db.odometerEntry.findMany({
      where: { vehicleId },
      orderBy: [{ recordedOn: 'desc' }, { value: 'desc' }],
      take: 100,
    })

    return entries.map((e: OdometerEntry) => ({
      id: e.id,
      value: e.value,
      unit: e.unit,
      recordedOn: dateOnlyString(e.recordedOn),
      source: e.source,
      isCorrection: e.isCorrection,
      correctionReason: e.correctionReason,
      notes: e.notes,
      createdAt: e.createdAt.toISOString(),
    }))
  }

  /** Current reading plus how much it should be trusted. */
  async currentOdometer(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const latest = await db.odometerEntry.findFirst({
      where: { vehicleId },
      orderBy: [{ recordedOn: 'desc' }, { value: 'desc' }],
    })

    if (!latest) {
      return {
        value: null,
        unit: vehicle.distanceUnit,
        recordedOn: null,
        ageDays: null,
        freshness: 'UNKNOWN' as const,
      }
    }

    const ageDays = Math.floor((Date.now() - latest.recordedOn.getTime()) / 86_400_000)
    return {
      value: latest.value,
      unit: latest.unit,
      recordedOn: dateOnlyString(latest.recordedOn),
      ageDays,
      freshness: ageDays > ODOMETER_STALE_DAYS ? ('STALE' as const) : ('FRESH' as const),
    }
  }

  /**
   * Odometer history is APPEND-ONLY. A correction is a new entry flagged as such, never
   * an edit — mileage history is evidence (DECISIONS.md D-001).
   */
  async addOdometerEntry(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    input: CreateOdometerEntryInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const today = new Date().toISOString().slice(0, 10)
    if (input.recordedOn > today) throw Errors.odometerFutureDate()

    const latest = await db.odometerEntry.findFirst({
      where: { vehicleId },
      orderBy: [{ recordedOn: 'desc' }, { value: 'desc' }],
    })

    if (latest && !input.allowRegression) {
      const incoming: Distance = { value: input.value, unit: input.unit }
      const existing: Distance = { value: latest.value, unit: latest.unit }
      // Compared in canonical metres, so a km reading against a miles history is safe.
      if (compareDistance(incoming, existing) < 0) {
        throw Errors.odometerRegression(latest.value, latest.unit)
      }
    }

    const entry = await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.odometerEntry.create({
        data: {
          workspaceId,
          vehicleId,
          value: input.value,
          unit: input.unit,
          recordedOn: toDateOnly(input.recordedOn),
          source: 'MANUAL',
          isCorrection: input.allowRegression,
          correctionReason: input.correctionReason ?? null,
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
      })

      // Refresh the cached current reading from the newest entry. The cache is derived;
      // the entries table remains the source of truth.
      const newest = await tx.odometerEntry.findFirst({
        where: { vehicleId, workspaceId },
        orderBy: [{ recordedOn: 'desc' }, { value: 'desc' }],
      })
      if (newest) {
        await tx.vehicle.update({
          where: { id: vehicleId },
          data: {
            currentOdometer: newest.value,
            currentOdometerUnit: newest.unit,
            currentOdometerAt: newest.recordedOn,
          },
        })
      }
      return created
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: input.allowRegression ? 'odometer.corrected' : 'odometer.recorded',
      resourceType: 'odometer_entry',
      resourceId: entry.id,
      metadata: { vehicleId, value: input.value, unit: input.unit },
    })

    return {
      id: entry.id,
      value: entry.value,
      unit: entry.unit,
      recordedOn: dateOnlyString(entry.recordedOn),
      isCorrection: entry.isCorrection,
    }
  }

  /**
   * Delegates to the shared TimelineService so there is exactly one timeline
   * implementation across the product (task brief §20).
   */
  async timeline(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()
    return this.timelineService.forVehicle(workspaceId, vehicleId)
  }

  private toSummary(v: {
    id: string
    manufacturer: string
    model: string
    trim: string | null
    modelYear: number | null
    registrationNumber: string | null
    status: string
    currentOdometer: number | null
    currentOdometerUnit: string | null
    currentOdometerAt: Date | null
    distanceUnit: string
    colour: string | null
    fuelType: string | null
  }) {
    return {
      id: v.id,
      manufacturer: v.manufacturer,
      model: v.model,
      trim: v.trim,
      modelYear: v.modelYear,
      registrationNumber: v.registrationNumber,
      status: v.status,
      colour: v.colour,
      fuelType: v.fuelType,
      currentOdometer: v.currentOdometer,
      currentOdometerUnit: (v.currentOdometerUnit ?? v.distanceUnit) as DistanceUnit,
      currentOdometerAt: dateOnlyString(v.currentOdometerAt),
      distanceUnit: v.distanceUnit as DistanceUnit,
      // Maintenance and inspection tracking arrive in Phases 4 and 6. Until a vehicle
      // actually has that data, the honest answer is "not tracked", not "healthy".
      maintenanceStatus: 'UNKNOWN' as const,
      inspectionStatus: 'UNKNOWN' as const,
      nextService: null,
    }
  }

  private toDetail(v: Record<string, unknown>) {
    const base = this.toSummary(v as never)
    return {
      ...base,
      generation: v.generation,
      vin: v.vin,
      engineName: v.engineName,
      engineCode: v.engineCode,
      displacementCc: v.displacementCc,
      powerKw: v.powerKw,
      transmission: v.transmission,
      drivetrain: v.drivetrain,
      bodyType: v.bodyType,
      firstRegisteredOn: dateOnlyString(v.firstRegisteredOn as Date | null),
      purchasedOn: dateOnlyString(v.purchasedOn as Date | null),
      purchasePrice: v.purchasePrice ? String(v.purchasePrice) : null,
      purchaseCurrency: v.purchaseCurrency,
      notes: v.notes,
      createdAt: (v.createdAt as Date).toISOString(),
    }
  }
}
