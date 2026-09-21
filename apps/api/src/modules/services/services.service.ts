import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateServiceInput, UpdateServiceInput } from '@autoservices/validation'
import { calendarDate } from '@autoservices/types'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import { MaintenanceService } from '../maintenance/maintenance.service.js'
import { ExpenseProjectionService } from '../expenses/expense-projection.service.js'

type ServiceRecordWithRelations = Prisma.ServiceRecordGetPayload<{
  include: {
    category: true
    parts: true
    vehicle: { select: { id: true; manufacturer: true; model: true; registrationNumber: true } }
  }
}>

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2))

export interface ServiceListFilters {
  vehicleId?: string
  categoryId?: string
  dateFrom?: string
  dateTo?: string
  q?: string
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
    private readonly projection: ExpenseProjectionService,
  ) {}

  /**
   * Mirrors a service into the expense ledger (OWN-008).
   *
   * `totalAmount` is the authoritative figure — the parts/labour/tax breakdown is
   * informational and need not sum to it (D-003), so projecting the breakdown instead
   * would disagree with the invoice. A service with no total projects nothing.
   */
  private async projectService(workspaceId: string, serviceId: string, userId: string) {
    const record = await this.prisma.raw.serviceRecord.findUnique({
      where: { id: serviceId },
      select: {
        id: true,
        vehicleId: true,
        performedOn: true,
        totalAmount: true,
        currency: true,
        title: true,
        workshopName: true,
        odometer: true,
        odometerUnit: true,
        deletedAt: true,
      },
    })
    if (!record) return
    await this.projection.project({
      workspaceId,
      sourceType: 'SERVICE',
      sourceRecordId: record.id,
      vehicleId: record.vehicleId,
      incurredOn: record.performedOn,
      amount: record.deletedAt ? null : ExpenseProjectionService.amountOf(record.totalAmount),
      currency: record.currency,
      description: record.title,
      vendorName: record.workshopName,
      odometer: record.odometer,
      odometerUnit: record.odometerUnit,
      createdByUserId: userId,
    })
  }

  async listCategories(workspaceId: string) {
    // System categories (workspaceId null) are shared; workspace categories are private.
    // The tenant extension cannot express "mine OR global", so this is one of the few
    // places that reads through the raw client with an explicit, reviewed predicate.
    const categories = await this.prisma.raw.serviceCategory.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return categories.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      description: c.description,
      isSystem: c.isSystem,
      defaultIntervalKm: c.defaultIntervalKm,
      defaultIntervalMonths: c.defaultIntervalMonths,
    }))
  }

  async list(workspaceId: string, filters: ServiceListFilters = {}) {
    const db = this.prisma.forWorkspace(workspaceId)
    const where: Prisma.ServiceRecordWhereInput = { deletedAt: null }
    if (filters.vehicleId) where.vehicleId = filters.vehicleId
    if (filters.categoryId) where.categoryId = filters.categoryId
    if (filters.dateFrom || filters.dateTo) {
      where.performedOn = {
        ...(filters.dateFrom ? { gte: toDateOnly(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: toDateOnly(filters.dateTo) } : {}),
      }
    }
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q, mode: 'insensitive' } },
        { description: { contains: filters.q, mode: 'insensitive' } },
        { workshopName: { contains: filters.q, mode: 'insensitive' } },
      ]
    }

    const records = await db.serviceRecord.findMany({
      where,
      orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }],
      include: {
        category: true,
        vehicle: {
          select: { id: true, manufacturer: true, model: true, registrationNumber: true },
        },
        _count: { select: { parts: true } },
      },
      take: 200,
    })

    return records.map((r) => this.toSummary(r))
  }

  async get(workspaceId: string, serviceId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const record = await db.serviceRecord.findFirst({
      where: { id: serviceId, deletedAt: null },
      include: {
        category: true,
        parts: { orderBy: { createdAt: 'asc' } },
        vehicle: {
          select: { id: true, manufacturer: true, model: true, registrationNumber: true },
        },
      },
    })
    if (!record) throw Errors.notFound('Service record')
    return this.toDetail(record)
  }

  /**
   * SRV-003 — the service-creation transaction.
   *
   * The user enters a service ONCE. Its consequences — the odometer reading, the
   * maintenance advance — are recorded as part of the same atomic write, not left as
   * separate chores (PRODUCT.md §4.2).
   */
  async create(workspaceId: string, vehicleId: string, userId: string, input: CreateServiceInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null } })
    if (!vehicle) throw Errors.vehicleNotFound()

    const today = new Date().toISOString().slice(0, 10)
    if (input.performedOn > today) throw Errors.serviceFutureDate()

    const created = await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      const { parts, ...rest } = input

      const record = await tx.serviceRecord.create({
        data: {
          workspaceId,
          vehicleId,
          performedOn: toDateOnly(rest.performedOn),
          odometer: rest.odometer ?? null,
          odometerUnit:
            rest.odometer !== undefined ? (rest.odometerUnit ?? vehicle.distanceUnit) : null,
          categoryId: rest.categoryId ?? null,
          title: rest.title,
          description: rest.description ?? null,
          workshopName: rest.workshopName ?? null,
          mechanicName: rest.mechanicName ?? null,
          partsTotal: rest.partsTotal ?? null,
          labourTotal: rest.labourTotal ?? null,
          taxTotal: rest.taxTotal ?? null,
          totalAmount: rest.totalAmount ?? null,
          currency: rest.currency ?? vehicle.purchaseCurrency ?? 'GBP',
          warrantyMonths: rest.warrantyMonths ?? null,
          nextServiceOn: rest.nextServiceOn ? toDateOnly(rest.nextServiceOn) : null,
          nextServiceOdometer: rest.nextServiceOdometer ?? null,
          notes: rest.notes ?? null,
          createdByUserId: userId,
          ...(parts?.length
            ? {
                parts: {
                  // workspaceId is omitted deliberately: it is part of the composite
                  // relation [serviceRecordId, workspaceId], which Prisma populates from
                  // the parent. Setting it manually in a nested create is rejected.
                  create: parts.map((p) => ({
                    name: p.name,
                    brand: p.brand ?? null,
                    manufacturer: p.manufacturer ?? null,
                    partNumber: p.partNumber ?? null,
                    quantity: p.quantity ?? 1,
                    unitPrice: p.unitPrice ?? null,
                    currency: rest.currency ?? 'GBP',
                    warrantyMonths: p.warrantyMonths ?? null,
                    supplierName: p.supplierName ?? null,
                    notes: p.notes ?? null,
                  })),
                },
              }
            : {}),
        },
        include: { parts: true, category: true },
      })

      // The service reading becomes part of the vehicle's mileage history, attributed
      // to its source so the timeline can explain where it came from.
      if (rest.odometer !== undefined && rest.odometer !== null) {
        const unit = rest.odometerUnit ?? vehicle.distanceUnit
        await tx.odometerEntry.create({
          data: {
            workspaceId,
            vehicleId,
            value: rest.odometer,
            unit,
            recordedOn: toDateOnly(rest.performedOn),
            source: 'SERVICE',
            sourceRecordId: record.id,
            createdByUserId: userId,
            notes: `Recorded with service: ${rest.title}`,
          },
        })

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
      }

      return record
    })

    // Advance any maintenance rule this service satisfies, then recompute vehicle state.
    await this.maintenance.completeMatchingRules(workspaceId, vehicleId, userId, {
      categoryId: input.categoryId ?? null,
      serviceRecordId: created.id,
      completedOn: calendarDate(input.performedOn),
      odometer: input.odometer ?? null,
      odometerUnit: input.odometerUnit ?? vehicle.distanceUnit,
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'service.created',
      resourceType: 'service_record',
      resourceId: created.id,
      metadata: { vehicleId, title: input.title, total: input.totalAmount ?? null },
    })

    await this.projectService(workspaceId, created.id, userId)
    return this.get(workspaceId, created.id)
  }

  async update(workspaceId: string, serviceId: string, userId: string, input: UpdateServiceInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.serviceRecord.findFirst({ where: { id: serviceId, deletedAt: null } })
    if (!existing) throw Errors.notFound('Service record')

    await db.serviceRecord.update({
      where: { id: serviceId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.performedOn !== undefined ? { performedOn: toDateOnly(input.performedOn) } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.workshopName !== undefined ? { workshopName: input.workshopName } : {}),
        ...(input.mechanicName !== undefined ? { mechanicName: input.mechanicName } : {}),
        ...(input.partsTotal !== undefined ? { partsTotal: input.partsTotal } : {}),
        ...(input.labourTotal !== undefined ? { labourTotal: input.labourTotal } : {}),
        ...(input.taxTotal !== undefined ? { taxTotal: input.taxTotal } : {}),
        ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'service.updated',
      resourceType: 'service_record',
      resourceId: serviceId,
    })
    await this.projectService(workspaceId, serviceId, userId)
    return this.get(workspaceId, serviceId)
  }

  /** Soft delete: the record is hidden but the history survives (DATABASE.md §5). */
  async remove(workspaceId: string, serviceId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.serviceRecord.findFirst({ where: { id: serviceId, deletedAt: null } })
    if (!existing) throw Errors.notFound('Service record')

    await db.serviceRecord.update({ where: { id: serviceId }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'service.deleted',
      resourceType: 'service_record',
      resourceId: serviceId,
      metadata: { title: existing.title, performedOn: dateStr(existing.performedOn) },
    })
    await this.projection.retract('SERVICE', serviceId)
  }

  /** Total spend per vehicle, grouped by currency — never summed across currencies. */
  async costSummary(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const grouped = await db.serviceRecord.groupBy({
      by: ['currency'],
      where: { vehicleId, deletedAt: null, totalAmount: { not: null } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    })
    return grouped.map((g) => ({
      currency: g.currency,
      total: g._sum.totalAmount?.toFixed(2) ?? '0.00',
      count: g._count._all,
    }))
  }

  private toSummary(r: {
    id: string
    performedOn: Date
    odometer: number | null
    odometerUnit: string | null
    title: string
    workshopName: string | null
    totalAmount: Prisma.Decimal | null
    currency: string
    category: { id: string; name: string; key: string } | null
    vehicle: { id: string; manufacturer: string; model: string; registrationNumber: string | null }
    _count?: { parts: number }
  }) {
    return {
      id: r.id,
      performedOn: dateStr(r.performedOn),
      odometer: r.odometer,
      odometerUnit: r.odometerUnit,
      title: r.title,
      workshopName: r.workshopName,
      totalAmount: dec(r.totalAmount),
      currency: r.currency,
      category: r.category
        ? { id: r.category.id, name: r.category.name, key: r.category.key }
        : null,
      vehicle: r.vehicle,
      partCount: r._count?.parts ?? 0,
    }
  }

  private toDetail(r: ServiceRecordWithRelations) {
    return {
      ...this.toSummary(r as never),
      description: r.description,
      mechanicName: r.mechanicName,
      partsTotal: dec(r.partsTotal),
      labourTotal: dec(r.labourTotal),
      taxTotal: dec(r.taxTotal),
      warrantyMonths: r.warrantyMonths,
      nextServiceOn: dateStr(r.nextServiceOn),
      nextServiceOdometer: r.nextServiceOdometer,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      parts: (r.parts ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        manufacturer: p.manufacturer,
        partNumber: p.partNumber,
        quantity: p.quantity.toString(),
        unitPrice: dec(p.unitPrice),
        currency: p.currency,
        warrantyMonths: p.warrantyMonths,
        supplierName: p.supplierName,
        notes: p.notes,
      })),
    }
  }
}
