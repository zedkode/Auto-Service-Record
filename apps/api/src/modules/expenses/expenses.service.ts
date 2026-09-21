import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateExpenseInput, UpdateExpenseInput } from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const dec = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2))

export interface ExpenseFilters {
  vehicleId?: string
  categoryId?: string
  dateFrom?: string
  dateTo?: string
  sourceType?: string
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listCategories(workspaceId: string) {
    const rows = await this.prisma.raw.expenseCategory.findMany({
      where: { OR: [{ workspaceId: null }, { workspaceId }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return rows.map((c) => ({ id: c.id, key: c.key, name: c.name, isSystem: c.isSystem }))
  }

  async list(workspaceId: string, filters: ExpenseFilters = {}) {
    const db = this.prisma.forWorkspace(workspaceId)
    const where: Prisma.ExpenseWhereInput = { deletedAt: null }
    if (filters.vehicleId) where.vehicleId = filters.vehicleId
    if (filters.categoryId) where.categoryId = filters.categoryId
    if (filters.sourceType) where.sourceType = filters.sourceType as never
    if (filters.dateFrom || filters.dateTo) {
      where.incurredOn = {
        ...(filters.dateFrom ? { gte: toDateOnly(filters.dateFrom) } : {}),
        ...(filters.dateTo ? { lte: toDateOnly(filters.dateTo) } : {}),
      }
    }

    const rows = await db.expense.findMany({
      where,
      orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
      include: {
        category: { select: { id: true, key: true, name: true } },
        vehicle: { select: { id: true, manufacturer: true, model: true } },
      },
    })
    return rows.map((r) => this.view(r))
  }

  /**
   * Totals for a period, by category and by vehicle.
   *
   * Reads `expenses` and nothing else. Summing service records separately and adding
   * them would double-count every service that projected itself (DATABASE.md §4.8).
   */
  async summary(workspaceId: string, from: string, to: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      incurredOn: { gte: toDateOnly(from), lte: toDateOnly(to) },
    }

    const rows = await db.expense.findMany({
      where,
      select: {
        amount: true,
        currency: true,
        vehicleId: true,
        categoryId: true,
        category: { select: { key: true, name: true } },
        vehicle: { select: { manufacturer: true, model: true } },
      },
    })

    const byCategory = new Map<string, { name: string; total: number; count: number }>()
    const byVehicle = new Map<string, { name: string; total: number; count: number }>()
    const currencies = new Set<string>()
    let total = 0

    for (const r of rows) {
      const amount = Number(r.amount)
      total += amount
      currencies.add(r.currency)

      const catKey = r.category?.key ?? 'uncategorised'
      const cat = byCategory.get(catKey) ?? {
        name: r.category?.name ?? 'Uncategorised',
        total: 0,
        count: 0,
      }
      cat.total += amount
      cat.count += 1
      byCategory.set(catKey, cat)

      const vKey = r.vehicleId ?? 'workspace'
      const veh = byVehicle.get(vKey) ?? {
        name: r.vehicle ? `${r.vehicle.manufacturer} ${r.vehicle.model}` : 'Whole workspace',
        total: 0,
        count: 0,
      }
      veh.total += amount
      veh.count += 1
      byVehicle.set(vKey, veh)
    }

    const money = (n: number) => n.toFixed(2)
    return {
      from,
      to,
      total: money(total),
      // Mixed currencies cannot be summed without a rate the platform does not have.
      // Saying so is better than presenting a meaningless number (DECISIONS.md D-054).
      currency: currencies.size === 1 ? [...currencies][0] : null,
      mixedCurrencies: currencies.size > 1,
      entries: rows.length,
      byCategory: [...byCategory.entries()]
        .map(([key, v]) => ({ key, name: v.name, total: money(v.total), count: v.count }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
      byVehicle: [...byVehicle.entries()]
        .map(([id, v]) => ({
          vehicleId: id === 'workspace' ? null : id,
          name: v.name,
          total: money(v.total),
          count: v.count,
        }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
    }
  }

  async create(workspaceId: string, userId: string, input: CreateExpenseInput) {
    const db = this.prisma.forWorkspace(workspaceId)

    if (input.vehicleId) {
      const vehicle = await db.vehicle.findFirst({
        where: { id: input.vehicleId, deletedAt: null },
        select: { id: true },
      })
      if (!vehicle) throw Errors.vehicleNotFound()
    }

    const created = await db.expense.create({
      data: {
        workspaceId,
        vehicleId: input.vehicleId ?? null,
        categoryId: input.categoryId ?? null,
        incurredOn: toDateOnly(input.incurredOn),
        amount: input.amount,
        currency: input.currency,
        vendorName: input.vendorName ?? null,
        odometer: input.odometer ?? null,
        odometerUnit: input.odometerUnit ?? null,
        description: input.description ?? null,
        sourceType: 'MANUAL',
        createdByUserId: userId,
      },
      include: {
        category: { select: { id: true, key: true, name: true } },
        vehicle: { select: { id: true, manufacturer: true, model: true } },
      },
    })

    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'expense.created',
      resourceType: 'expense',
      resourceId: created.id,
      metadata: { vehicleId: created.vehicleId, categoryId: created.categoryId },
    })
    return this.view(created)
  }

  async update(workspaceId: string, id: string, userId: string, input: UpdateExpenseInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.expense.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Expense')
    this.assertManual(existing.sourceType)

    const updated = await db.expense.update({
      where: { id },
      data: {
        ...(input.vehicleId !== undefined ? { vehicleId: input.vehicleId } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.incurredOn !== undefined ? { incurredOn: toDateOnly(input.incurredOn) } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.vendorName !== undefined ? { vendorName: input.vendorName } : {}),
        ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
        ...(input.odometerUnit !== undefined ? { odometerUnit: input.odometerUnit } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
      include: {
        category: { select: { id: true, key: true, name: true } },
        vehicle: { select: { id: true, manufacturer: true, model: true } },
      },
    })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'expense.updated',
      resourceType: 'expense',
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    })
    return this.view(updated)
  }

  async remove(workspaceId: string, id: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.expense.findFirst({ where: { id, deletedAt: null } })
    if (!existing) throw Errors.notFound('Expense')
    this.assertManual(existing.sourceType)

    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'expense.deleted',
      resourceType: 'expense',
      resourceId: id,
      metadata: { soft: true },
    })
  }

  /**
   * A projected expense is derived data. Editing it here would be silently undone the
   * next time its source record changed, so the refusal explains where to go instead.
   */
  private assertManual(sourceType: string) {
    if (sourceType !== 'MANUAL') {
      throw Errors.projectedExpenseReadOnly(sourceType)
    }
  }

  private view(
    r: Prisma.ExpenseGetPayload<{
      include: {
        category: { select: { id: true; key: true; name: true } }
        vehicle: { select: { id: true; manufacturer: true; model: true } }
      }
    }>,
  ) {
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleName: r.vehicle ? `${r.vehicle.manufacturer} ${r.vehicle.model}` : null,
      categoryId: r.categoryId,
      categoryKey: r.category?.key ?? null,
      categoryName: r.category?.name ?? null,
      incurredOn: dateStr(r.incurredOn),
      amount: dec(r.amount),
      currency: r.currency,
      vendorName: r.vendorName,
      odometer: r.odometer,
      odometerUnit: r.odometerUnit,
      description: r.description,
      sourceType: r.sourceType,
      sourceRecordId: r.sourceRecordId,
      /** Derived rows are read-only; the UI uses this rather than re-deriving the rule. */
      isProjected: r.sourceType !== 'MANUAL',
      createdAt: r.createdAt.toISOString(),
    }
  }
}
