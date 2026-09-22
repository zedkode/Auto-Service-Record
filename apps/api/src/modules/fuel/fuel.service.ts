import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { CreateFuelEntryInput, UpdateFuelEntryInput } from '@autoservices/validation'
import { PrismaService } from '../../common/prisma.service.js'
import { AuditService } from '../../common/audit/audit.service.js'
import { Errors } from '../../common/errors.js'
import { ExpenseProjectionService } from '../expenses/expense-projection.service.js'
import { computeEconomy, type FuelFill } from './fuel.engine.js'

const toDateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const dec = (v: Prisma.Decimal | null, places = 2) => (v === null ? null : v.toFixed(places))

@Injectable()
export class FuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly projection: ExpenseProjectionService,
  ) {}

  async list(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.fuelEntry.findMany({
      where: { vehicleId, deletedAt: null },
      orderBy: [{ odometer: 'desc' }, { filledOn: 'desc' }],
    })
    return rows.map((r) => this.view(r))
  }

  /**
   * Consumption for one vehicle, computed by the pure engine over every recorded fill.
   *
   * The engine decides what is measurable; this method only feeds it. When there is no
   * usable interval it returns the reason rather than a number, so the UI can say why
   * (DECISIONS.md D-002).
   */
  async economy(workspaceId: string, vehicleId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const rows = await db.fuelEntry.findMany({
      where: { vehicleId, deletedAt: null },
      orderBy: { odometer: 'asc' },
    })

    const fills: FuelFill[] = rows.map((r) => ({
      id: r.id,
      filledOn: dateStr(r.filledOn)!,
      odometer: r.odometer,
      odometerUnit: r.odometerUnit,
      quantity: Number(r.quantity),
      quantityUnit: r.quantityUnit,
      isFullTank: r.isFullTank,
      missedFill: r.missedFill,
    }))

    return { ...computeEconomy(fills), fillCount: fills.length }
  }

  async create(
    workspaceId: string,
    vehicleId: string,
    userId: string,
    input: CreateFuelEntryInput,
  ) {
    const db = this.prisma.forWorkspace(workspaceId)
    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, deletedAt: null },
      select: { id: true, distanceUnit: true, fuelType: true },
    })
    if (!vehicle) throw Errors.vehicleNotFound()

    const unit = input.odometerUnit ?? vehicle.distanceUnit

    const created = await this.prisma.raw.$transaction(async (tx: Prisma.TransactionClient) => {
      const entry = await tx.fuelEntry.create({
        data: {
          workspaceId,
          vehicleId,
          filledOn: toDateOnly(input.filledOn),
          odometer: input.odometer,
          odometerUnit: unit,
          quantity: input.quantity,
          quantityUnit: input.quantityUnit,
          totalAmount: input.totalAmount ?? null,
          unitPrice: input.unitPrice ?? null,
          currency: input.currency,
          fuelType: input.fuelType ?? vehicle.fuelType ?? null,
          isFullTank: input.isFullTank,
          isPartialFill: !input.isFullTank,
          missedFill: input.missedFill,
          stationName: input.stationName ?? null,
          notes: input.notes ?? null,
          createdByUserId: userId,
        },
      })

      // Filling up is a mileage reading, and the most frequent one most people take. It
      // joins the vehicle's history attributed to its source, exactly as a service does.
      await tx.odometerEntry.create({
        data: {
          workspaceId,
          vehicleId,
          value: input.odometer,
          unit,
          recordedOn: toDateOnly(input.filledOn),
          source: 'FUEL',
          sourceRecordId: entry.id,
          createdByUserId: userId,
          notes: input.stationName
            ? `Recorded at a fill: ${input.stationName}`
            : 'Recorded at a fill',
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

      return entry
    })

    await this.projectFuel(workspaceId, created.id, userId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'fuel.recorded',
      resourceType: 'fuel_entry',
      resourceId: created.id,
      metadata: {
        vehicleId,
        quantity: String(input.quantity),
        quantityUnit: input.quantityUnit,
        isFullTank: input.isFullTank,
      },
    })
    return this.view(created)
  }

  async update(workspaceId: string, entryId: string, userId: string, input: UpdateFuelEntryInput) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.fuelEntry.findFirst({ where: { id: entryId, deletedAt: null } })
    if (!existing) throw Errors.notFound('Fuel entry')

    const updated = await db.fuelEntry.update({
      where: { id: entryId },
      data: {
        ...(input.filledOn !== undefined ? { filledOn: toDateOnly(input.filledOn) } : {}),
        ...(input.odometer !== undefined ? { odometer: input.odometer } : {}),
        ...(input.odometerUnit !== undefined ? { odometerUnit: input.odometerUnit } : {}),
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.quantityUnit !== undefined ? { quantityUnit: input.quantityUnit } : {}),
        ...(input.totalAmount !== undefined ? { totalAmount: input.totalAmount } : {}),
        ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.fuelType !== undefined ? { fuelType: input.fuelType } : {}),
        ...(input.isFullTank !== undefined
          ? { isFullTank: input.isFullTank, isPartialFill: !input.isFullTank }
          : {}),
        ...(input.missedFill !== undefined ? { missedFill: input.missedFill } : {}),
        ...(input.stationName !== undefined ? { stationName: input.stationName } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    })

    await this.projectFuel(workspaceId, entryId, userId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'fuel.updated',
      resourceType: 'fuel_entry',
      resourceId: entryId,
      metadata: { fields: Object.keys(input) },
    })
    return this.view(updated)
  }

  /**
   * Soft delete. A fill is part of the mileage chain, and removing it outright would
   * silently change every economy figure computed around it.
   */
  async remove(workspaceId: string, entryId: string, userId: string) {
    const db = this.prisma.forWorkspace(workspaceId)
    const existing = await db.fuelEntry.findFirst({ where: { id: entryId, deletedAt: null } })
    if (!existing) throw Errors.notFound('Fuel entry')

    await db.fuelEntry.update({ where: { id: entryId }, data: { deletedAt: new Date() } })
    await this.projection.retract('FUEL', entryId)
    await this.audit.record({
      workspaceId,
      actorUserId: userId,
      action: 'fuel.deleted',
      resourceType: 'fuel_entry',
      resourceId: entryId,
      metadata: { soft: true },
    })
  }

  /**
   * Mirrors the fill into the expense ledger (OWN-008) — the last source that was
   * missing, so a vehicle's total cost of ownership now includes what it drank.
   */
  private async projectFuel(workspaceId: string, entryId: string, userId: string) {
    const entry = await this.prisma.raw.fuelEntry.findUnique({ where: { id: entryId } })
    if (!entry) return

    const label = entry.quantityUnit === 'KWH' ? 'Charging' : 'Fuel'
    await this.projection.project({
      workspaceId,
      sourceType: 'FUEL',
      sourceRecordId: entry.id,
      vehicleId: entry.vehicleId,
      incurredOn: entry.filledOn,
      amount: entry.deletedAt ? null : ExpenseProjectionService.amountOf(entry.totalAmount),
      currency: entry.currency,
      description: `${label} — ${Number(entry.quantity)} ${entry.quantityUnit.toLowerCase()}`,
      vendorName: entry.stationName,
      odometer: entry.odometer,
      odometerUnit: entry.odometerUnit,
      createdByUserId: userId,
    })
  }

  private view(r: {
    id: string
    vehicleId: string
    filledOn: Date
    odometer: number
    odometerUnit: string
    quantity: Prisma.Decimal
    quantityUnit: string
    totalAmount: Prisma.Decimal | null
    unitPrice: Prisma.Decimal | null
    currency: string
    fuelType: string | null
    isFullTank: boolean
    missedFill: boolean
    stationName: string | null
    notes: string | null
    createdAt: Date
  }) {
    return {
      id: r.id,
      vehicleId: r.vehicleId,
      filledOn: dateStr(r.filledOn),
      odometer: r.odometer,
      odometerUnit: r.odometerUnit,
      quantity: Number(r.quantity),
      quantityUnit: r.quantityUnit,
      totalAmount: dec(r.totalAmount),
      unitPrice: dec(r.unitPrice, 4),
      currency: r.currency,
      fuelType: r.fuelType,
      isFullTank: r.isFullTank,
      missedFill: r.missedFill,
      stationName: r.stationName,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    }
  }
}
