import { Injectable } from '@nestjs/common'
import type { Prisma, OdometerEntry, Vehicle } from '@prisma/client'
import type { CreateVehicleInput, CreateOdometerEntryInput } from '@autoservices/validation'
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

  async list(workspaceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return vehicles.map((v: Vehicle) => this.toSummary(v))
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
