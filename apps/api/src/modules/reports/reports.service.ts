import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service.js'
import { Errors } from '../../common/errors.js'
import { computeCostReport, type ReportExpense, type ReportOdometer } from './reports.engine.js'
import { computeFleetReport, type FleetObligation, type FleetVehicle } from './fleet.engine.js'

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
      // A soft-deleted vehicle is hidden from all reads, so its costs leave the totals
      // with it. Workspace-level costs (no vehicle) are unaffected.
      OR: [{ vehicleId: null }, { vehicle: { deletedAt: null } }],
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

  /**
   * RPT-004 — the workspace as a fleet.
   *
   * Same sources as `costs()`, arranged per vehicle: which one is the most expensive to
   * run, and which one is about to lapse. Obligations come from the three records that
   * carry an expiry — inspections, policies and tax — rather than from `reminders`, so a
   * van whose reminder has been dismissed, snoozed or not yet generated still reports its
   * true compliance state.
   */
  async fleet(workspaceId: string, filters: { from: string; to: string }) {
    const db = this.prisma.forWorkspace(workspaceId)
    const period = { gte: toDateOnly(filters.from), lte: toDateOnly(filters.to) }

    const [vehicles, expenses, odometer, inspections, policies, tax] = await Promise.all([
      db.vehicle.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          manufacturer: true,
          model: true,
          registrationNumber: true,
          status: true,
        },
      }),
      db.expense.findMany({
        where: {
          deletedAt: null,
          incurredOn: period,
          OR: [{ vehicleId: null }, { vehicle: { deletedAt: null } }],
        },
        select: {
          amount: true,
          currency: true,
          incurredOn: true,
          vehicleId: true,
          category: { select: { key: true, name: true } },
        },
      }),
      db.odometerEntry.findMany({
        where: { recordedOn: period, isCorrection: false, vehicle: { deletedAt: null } },
        select: { vehicleId: true, recordedOn: true, value: true, unit: true },
      }),
      db.vehicleInspection.findMany({
        where: { expiresOn: { not: null }, vehicle: { deletedAt: null } },
        select: { vehicleId: true, expiresOn: true },
      }),
      db.insurancePolicy.findMany({
        where: { expiresOn: { not: null }, vehicle: { deletedAt: null } },
        select: { vehicleId: true, expiresOn: true },
      }),
      db.roadTaxRecord.findMany({
        where: { expiresOn: { not: null }, vehicle: { deletedAt: null } },
        select: { vehicleId: true, expiresOn: true },
      }),
    ])

    /**
     * Only the LATEST expiry of each kind per vehicle counts. A van with five years of MOT
     * history has five expiry dates, four of them long past, and taking the soonest of all
     * of them would report every well-maintained vehicle as expired.
     */
    const latestPerKind = (
      rows: Array<{ vehicleId: string; expiresOn: Date | null }>,
      kind: FleetObligation['kind'],
    ): FleetObligation[] => {
      const latest = new Map<string, string>()
      for (const row of rows) {
        if (!row.expiresOn) continue
        const date = dateStr(row.expiresOn)
        const current = latest.get(row.vehicleId)
        if (!current || date > current) latest.set(row.vehicleId, date)
      }
      return [...latest.entries()].map(([vehicleId, expiresOn]) => ({ vehicleId, kind, expiresOn }))
    }

    return computeFleetReport({
      from: filters.from,
      to: filters.to,
      // Compliance is about today, not about the reporting window: a report run over last
      // year must still say whether the MOT has run out now.
      asOf: dateStr(new Date()),
      vehicles: vehicles.map(
        (v): FleetVehicle => ({
          id: v.id,
          displayName: `${v.manufacturer} ${v.model}`,
          registrationNumber: v.registrationNumber,
          status: v.status,
        }),
      ),
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
      obligations: [
        ...latestPerKind(inspections, 'INSPECTION'),
        ...latestPerKind(policies, 'INSURANCE'),
        ...latestPerKind(tax, 'TAX'),
      ],
    })
  }
}
