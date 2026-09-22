import { Injectable } from '@nestjs/common'
import type { CreateWarrantyInput, UpdateWarrantyInput } from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import { warrantyStatus, type WarrantyType } from './warranty.engine.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/**
 * OWN-004 — warranties.
 *
 * The same shape as inspections, policies and road tax, with one addition that changes how
 * it must be read: a warranty can end on mileage before it ends on a date. The state is
 * computed by the engine against the vehicle's CURRENT reading on every read, never stored
 * — a stored "ACTIVE" becomes a lie the moment the odometer moves (DECISIONS.md D-099).
 */
@Injectable()
export class WarrantiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string, vehicleId?: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.warranty.findMany({
      where: { deletedAt: null, ...(vehicleId ? { vehicleId } : {}) },
      orderBy: [{ startsOn: 'desc' }, { createdAt: 'desc' }],
    })
    if (rows.length === 0) return []

    // One read for every vehicle involved, rather than one per warranty (HARD-004).
    const vehicles = await db.vehicle.findMany({
      where: { id: { in: [...new Set(rows.map((r: WarrantyRow) => r.vehicleId))] } },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        currentOdometer: true,
        currentOdometerUnit: true,
      },
    })
    const byId = new Map(vehicles.map((v: VehicleRow) => [v.id, v]))
    return rows.map((r: WarrantyRow) => this.view(r, byId.get(r.vehicleId)))
  }

  async get(workspaceId: string, id: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const row = await db.warranty.findFirst({ where: { id, deletedAt: null } })
    if (!row) throw Errors.notFound('Warranty')
    const vehicle = await db.vehicle.findFirst({
      where: { id: row.vehicleId },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        currentOdometer: true,
        currentOdometerUnit: true,
      },
    })
    return this.view(row, vehicle ?? undefined)
  }

  async create(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    input: CreateWarrantyInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        currentOdometer: true,
        currentOdometerUnit: true,
      },
    })
    if (!vehicle) throw Errors.vehicleNotFound()

    if (input.serviceRecordId) {
      const service = await db.serviceRecord.findFirst({
        where: { id: input.serviceRecordId, vehicleId, deletedAt: null },
        select: { id: true },
      })
      // A warranty can only be attached to work done on ITS OWN vehicle.
      if (!service) throw Errors.notFound('Service record')
    }

    const created = await db.warranty.create({
      data: {
        workspaceId,
        vehicleId,
        warrantyType: input.warrantyType,
        providerName: input.providerName ?? null,
        reference: input.reference ?? null,
        startsOn: toDateOnly(input.startsOn),
        expiresOn: input.expiresOn ? toDateOnly(input.expiresOn) : null,
        distanceLimit: input.distanceLimit ?? null,
        distanceLimitUnit: input.distanceLimitUnit ?? null,
        startOdometer: input.startOdometer ?? null,
        startOdometerUnit: input.startOdometerUnit ?? null,
        coverageNotes: input.coverageNotes ?? null,
        serviceRecordId: input.serviceRecordId ?? null,
        createdByUserId: userId,
      },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'warranty.created',
      resourceType: 'warranty',
      resourceId: created.id,
      metadata: { vehicleId, warrantyType: created.warrantyType },
    })
    return this.view(created, vehicle)
  }

  async update(workspaceId: string, id: string, userId: string, input: UpdateWarrantyInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.warranty.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Warranty')

    const updated = await db.warranty.update({
      where: { id },
      data: {
        ...(input.warrantyType !== undefined ? { warrantyType: input.warrantyType } : {}),
        ...(input.providerName !== undefined ? { providerName: input.providerName } : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.startsOn !== undefined ? { startsOn: toDateOnly(input.startsOn) } : {}),
        ...(input.expiresOn !== undefined ? { expiresOn: toDateOnly(input.expiresOn) } : {}),
        ...(input.distanceLimit !== undefined ? { distanceLimit: input.distanceLimit } : {}),
        ...(input.distanceLimitUnit !== undefined
          ? { distanceLimitUnit: input.distanceLimitUnit }
          : {}),
        ...(input.startOdometer !== undefined ? { startOdometer: input.startOdometer } : {}),
        ...(input.startOdometerUnit !== undefined
          ? { startOdometerUnit: input.startOdometerUnit }
          : {}),
        ...(input.coverageNotes !== undefined ? { coverageNotes: input.coverageNotes } : {}),
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'warranty.updated',
      resourceType: 'warranty',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    const vehicle = await db.vehicle.findFirst({
      where: { id: updated.vehicleId },
      select: {
        id: true,
        manufacturer: true,
        model: true,
        currentOdometer: true,
        currentOdometerUnit: true,
      },
    })
    return this.view(updated, vehicle ?? undefined)
  }

  async remove(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.warranty.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Warranty')
    await db.warranty.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'warranty.deleted',
      resourceType: 'warranty',
      resourceId: id,
      metadata: { soft: true },
    })
  }

  private view(row: WarrantyRow, vehicle?: VehicleRow) {
    const status = warrantyStatus(
      {
        warrantyType: row.warrantyType as WarrantyType,
        startsOn: dateStr(row.startsOn)!,
        expiresOn: dateStr(row.expiresOn),
        distanceLimit: row.distanceLimit,
        distanceLimitUnit: row.distanceLimitUnit,
        startOdometer: row.startOdometer,
        startOdometerUnit: row.startOdometerUnit,
      },
      {
        currentOdometer: vehicle?.currentOdometer ?? null,
        currentOdometerUnit: vehicle?.currentOdometerUnit ?? null,
      },
      new Date().toISOString().slice(0, 10),
    )

    return {
      id: row.id,
      vehicleId: row.vehicleId,
      vehicleName: vehicle ? `${vehicle.manufacturer} ${vehicle.model}` : null,
      warrantyType: row.warrantyType,
      providerName: row.providerName,
      reference: row.reference,
      startsOn: dateStr(row.startsOn),
      expiresOn: dateStr(row.expiresOn),
      distanceLimit: row.distanceLimit,
      distanceLimitUnit: row.distanceLimitUnit,
      startOdometer: row.startOdometer,
      startOdometerUnit: row.startOdometerUnit,
      coverageNotes: row.coverageNotes,
      serviceRecordId: row.serviceRecordId,
      // Computed on every read, never stored: see the class comment.
      status,
    }
  }
}

interface WarrantyRow {
  id: string
  vehicleId: string
  warrantyType: string
  providerName: string | null
  reference: string | null
  startsOn: Date
  expiresOn: Date | null
  distanceLimit: number | null
  distanceLimitUnit: 'MILES' | 'KILOMETERS' | null
  startOdometer: number | null
  startOdometerUnit: 'MILES' | 'KILOMETERS' | null
  coverageNotes: string | null
  serviceRecordId: string | null
}

interface VehicleRow {
  id: string
  manufacturer: string
  model: string
  currentOdometer: number | null
  currentOdometerUnit: 'MILES' | 'KILOMETERS' | null
}
