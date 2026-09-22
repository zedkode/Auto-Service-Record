import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service.js'
import { Errors } from '../../common/errors.js'
import { computeCostReport, type ReportExpense, type ReportOdometer } from './reports.engine.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date) => d.toISOString().slice(0, 10)

export interface ReportFilters {
  from: string
  to: string
  vehicleId?: string
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RPT-001/002 — the cost report.
   *
   * Reads `expenses` and nothing else for money, because that table is the single cost
   * surface: summing service records or fuel entries separately would double-count
   * everything that already projects into it (DATABASE.md §4.8, DECISIONS.md D-058).
   *
   * Mileage comes from `odometer_entries`, which is append-only, so the distance behind
   * a cost-per-mile figure is evidence rather than a current-value snapshot.
   */
  async costs(workspaceId: string, filters: ReportFilters) {
    const db = this.prisma.forWorkspace(workspaceId)

    if (filters.vehicleId) {
      const vehicle = await db.vehicle.findFirst({
        where: { id: filters.vehicleId, deletedAt: null },
        select: { id: true },
      })
      if (!vehicle) throw Errors.vehicleNotFound()
    }

    const period = {
      gte: toDateOnly(filters.from),
      lte: toDateOnly(filters.to),
    }

    const expenseWhere: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      incurredOn: period,
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
    }
    const odometerWhere: Prisma.OdometerEntryWhereInput = {
      recordedOn: period,
      ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
      // A correction restates a past reading rather than recording travel, so including
      // it would invent distance the vehicle never covered.
      isCorrection: false,
      vehicle: { deletedAt: null },
    }

    const [expenses, odometer] = await Promise.all([
      db.expense.findMany({
        where: expenseWhere,
        select: {
          amount: true,
          currency: true,
          incurredOn: true,
          vehicleId: true,
          category: { select: { key: true, name: true } },
        },
      }),
      db.odometerEntry.findMany({
        where: odometerWhere,
        select: { vehicleId: true, recordedOn: true, value: true, unit: true },
      }),
    ])

    const report = computeCostReport({
      from: filters.from,
      to: filters.to,
      expenses: expenses.map(
        (e): ReportExpense => ({
          amount: Number(e.amount),
          currency: e.currency,
          incurredOn: dateStr(e.incurredOn),
          vehicleId: e.vehicleId,
          categoryKey: e.category?.key ?? null,
          categoryName: e.category?.name ?? null,
        }),
      ),
      odometer: odometer.map(
        (o): ReportOdometer => ({
          vehicleId: o.vehicleId,
          recordedOn: dateStr(o.recordedOn),
          value: o.value,
          unit: o.unit,
        }),
      ),
    })

    // Names are attached here rather than in the engine, which stays free of I/O.
    const vehicles = await db.vehicle.findMany({
      where: { deletedAt: null },
      select: { id: true, manufacturer: true, model: true, registrationNumber: true },
    })
    const nameOf = new Map(vehicles.map((v) => [v.id, `${v.manufacturer} ${v.model}`] as const))

    return {
      ...report,
      byVehicle: report.byVehicle.map((row) => ({
        ...row,
        name: row.vehicleId ? (nameOf.get(row.vehicleId) ?? 'Removed vehicle') : 'Whole workspace',
      })),
    }
  }
}
