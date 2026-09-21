import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../common/prisma.service.js'

export type ProjectedSource = 'SERVICE' | 'INSURANCE' | 'TAX' | 'FUEL'

export interface ProjectionInput {
  workspaceId: string
  sourceType: ProjectedSource
  sourceRecordId: string
  vehicleId: string | null
  incurredOn: Date
  /** Decimal string, or null to withdraw the projection entirely. */
  amount: string | null
  currency: string
  description: string
  vendorName?: string | null
  odometer?: number | null
  odometerUnit?: 'MILES' | 'KILOMETERS' | null
  createdByUserId?: string | null
}

/** The system category each kind of projection lands in. */
const CATEGORY_KEY: Record<ProjectedSource, string> = {
  SERVICE: 'servicing',
  INSURANCE: 'insurance',
  TAX: 'tax',
  FUEL: 'fuel',
}

/**
 * OWN-008 — projecting other records into the expense ledger.
 *
 * `expenses` is the single cost surface: reports read it and nothing else, so a service
 * must never be counted both directly and through its projection (DATABASE.md §4.8).
 * That is enforced structurally rather than by convention — `(sourceType,
 * sourceRecordId)` is unique, so re-projecting an edited service updates the one row it
 * already owns instead of adding a second.
 *
 * A projection is **derived data**. It is written, updated and withdrawn by this service
 * only; a user editing the number would simply see it overwritten the next time the
 * source record changed, so the API refuses to edit or delete projected rows directly.
 */
@Injectable()
export class ExpenseProjectionService {
  private readonly logger = new Logger('ExpenseProjection')

  constructor(private readonly prisma: PrismaService) {}

  private async categoryId(key: string): Promise<string | null> {
    // System categories have workspaceId null and are shared, which the tenant client
    // cannot express — one of the few reviewed uses of the raw client.
    const row = await this.prisma.raw.expenseCategory.findFirst({
      where: { workspaceId: null, key },
      select: { id: true },
    })
    return row?.id ?? null
  }

  /**
   * Creates, updates or withdraws the expense that mirrors a source record.
   *
   * A null amount withdraws it: a service whose total was cleared, or a policy with no
   * premium recorded, must not leave a stale cost behind in the ledger.
   */
  async project(input: ProjectionInput): Promise<void> {
    const key = { sourceType: input.sourceType, sourceRecordId: input.sourceRecordId }

    if (input.amount === null) {
      await this.retract(input.sourceType, input.sourceRecordId)
      return
    }

    try {
      await this.prisma.raw.expense.upsert({
        where: { sourceType_sourceRecordId: key },
        create: {
          workspaceId: input.workspaceId,
          vehicleId: input.vehicleId,
          categoryId: await this.categoryId(CATEGORY_KEY[input.sourceType]),
          incurredOn: input.incurredOn,
          amount: input.amount,
          currency: input.currency,
          vendorName: input.vendorName ?? null,
          odometer: input.odometer ?? null,
          odometerUnit: input.odometerUnit ?? null,
          description: input.description,
          sourceType: input.sourceType,
          sourceRecordId: input.sourceRecordId,
          createdByUserId: input.createdByUserId ?? null,
        },
        update: {
          incurredOn: input.incurredOn,
          amount: input.amount,
          currency: input.currency,
          vendorName: input.vendorName ?? null,
          odometer: input.odometer ?? null,
          odometerUnit: input.odometerUnit ?? null,
          description: input.description,
          // A source record that comes back to life takes its expense with it.
          deletedAt: null,
        },
      })
    } catch (err) {
      // A failed projection must never fail the write that triggered it: the user's
      // service record is the real data, the expense row is a convenience.
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          sourceType: input.sourceType,
          sourceRecordId: input.sourceRecordId,
        },
        'could not project expense',
      )
    }
  }

  /** Soft-deletes the projection for a source record that was removed. */
  async retract(sourceType: ProjectedSource, sourceRecordId: string): Promise<void> {
    try {
      await this.prisma.raw.expense.updateMany({
        where: { sourceType, sourceRecordId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), sourceType, sourceRecordId },
        'could not retract expense',
      )
    }
  }

  /** Decimal → the canonical string form, or null when there is nothing to project. */
  static amountOf(value: Prisma.Decimal | string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const s = typeof value === 'string' ? value : value.toFixed(2)
    return Number(s) === 0 ? null : s
  }
}
