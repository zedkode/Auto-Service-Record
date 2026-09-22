/**
 * EXP-001 — builds a data export and puts it in object storage.
 *
 * Runs in the worker, not the API, because a workspace with years of history produces a
 * file that takes seconds to assemble and megabytes to hold: an HTTP request that does
 * this blocks a connection and times out on exactly the accounts that most need the export
 * (ADR-004).
 *
 * The job is idempotent. A retry after a crash re-reads the same rows and overwrites the
 * same key, and a job whose row has already reached a terminal state does nothing at all.
 */
import type { Job } from 'bullmq'
import { randomBytes } from 'node:crypto'
import {
  CONTENT_TYPE,
  COLUMNS_FOR,
  exportFilename,
  toCsvFile,
  toJsonFile,
  type ExportFormat,
  type ExportKind,
} from '@autoservices/export'
import type { Logger } from 'pino'
import type { ObjectStorage } from '@autoservices/storage'

export interface BuildExportJobData {
  exportJobId: string
  workspaceId: string
}

export interface ExportJobContext {
  prisma: ExportPrisma
  storage: ObjectStorage
  logger: Logger
}

/** The narrow slice of the client this handler needs, so it can be tested without one. */
export interface ExportPrisma {
  exportJob: {
    findFirst(args: unknown): Promise<ExportJobRow | null>
    update(args: unknown): Promise<unknown>
  }
  vehicle: { findMany(args: unknown): Promise<VehicleLike[]> }
  expense: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  serviceRecord: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  fuelEntry: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  odometerEntry: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
}

interface ExportJobRow {
  id: string
  workspaceId: string
  kind: ExportKind
  format: ExportFormat
  status: string
  params: unknown
  objectKey: string | null
}

interface VehicleLike {
  id: string
  manufacturer: string
  model: string
  registrationNumber: string | null
  [key: string]: unknown
}

/** Exports are short-lived: a copy of tenant data living outside the database. */
export const EXPORT_TTL_HOURS = 24

const dateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '')
/**
 * Decimals are formatted at the precision the COLUMN stores, not at a convenient default.
 * `quantity` is Decimal(10,3) and `unit_price` is Decimal(10,4): rendering either at two
 * places silently drops a digit the database was asked to keep, and an export is the one
 * place that loss becomes permanent — it leaves for a spreadsheet that has no way back.
 */
const atPlaces = (v: unknown, places: number): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && 'toFixed' in (v as object)) {
    return (v as { toFixed(n: number): string }).toFixed(places)
  }
  return String(v)
}
/** Money: always two places, always a string (AGENTS.md: never `number` on prices). */
const dec = (v: unknown) => atPlaces(v, 2)

/**
 * A random key. Never derived from the workspace id, the user or the filename: a
 * predictable key turns "you need a signed URL" into "you need to guess a number"
 * (SECURITY.md, and the enumeration cases in scripts/pentest-documents.mjs).
 */
function objectKeyFor(workspaceId: string, filename: string) {
  return `exports/${workspaceId}/${randomBytes(24).toString('hex')}/${filename}`
}

export async function handleBuildExport(job: Job, ctx: ExportJobContext): Promise<unknown> {
  const { exportJobId, workspaceId } = job.data as BuildExportJobData
  const row = await ctx.prisma.exportJob.findFirst({ where: { id: exportJobId, workspaceId } })

  if (!row) {
    // The row was deleted, or the workspace was. Nothing to build and nothing to report.
    ctx.logger.warn({ exportJobId }, 'export job row is gone; skipping')
    return { skipped: 'MISSING' }
  }
  if (row.status === 'READY' || row.status === 'EXPIRED') {
    // A duplicate delivery of a job that already produced its file.
    return { skipped: row.status }
  }

  await ctx.prisma.exportJob.update({
    where: { id: row.id },
    data: { status: 'RUNNING', startedAt: new Date(), error: null },
  })

  try {
    const params = (row.params ?? {}) as { from?: string; to?: string; vehicleId?: string }
    const { rows, columns } = await collect(ctx.prisma, workspaceId, row.kind, params)

    const generatedOn = new Date().toISOString().slice(0, 10)
    const filename = exportFilename(row.kind, row.format, generatedOn)
    const body =
      row.format === 'CSV'
        ? toCsvFile(rows as never[], columns as never)
        : toJsonFile(rows as never[], columns as never)

    // Reuse the key on a retry so a repeated run overwrites rather than orphaning a file.
    const key = row.objectKey ?? objectKeyFor(workspaceId, filename)
    const stored = await ctx.storage.put(key, body, CONTENT_TYPE[row.format])

    const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3_600_000)
    await ctx.prisma.exportJob.update({
      where: { id: row.id },
      data: {
        status: 'READY',
        objectKey: key,
        filename,
        byteSize: stored.byteSize,
        rowCount: rows.length,
        completedAt: new Date(),
        expiresAt,
      },
    })

    ctx.logger.info(
      { exportJobId: row.id, kind: row.kind, format: row.format, rows: rows.length },
      'export built',
    )
    return { rows: rows.length, bytes: stored.byteSize }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ctx.logger.error({ exportJobId: row.id, err: message }, 'export failed')
    await ctx.prisma.exportJob.update({
      where: { id: row.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        // Shown to the user, so it says what happened and nothing about the query.
        error: 'The export could not be built. Try again, or narrow the date range.',
      },
    })
    throw err
  }
}

async function collect(
  prisma: ExportPrisma,
  workspaceId: string,
  kind: ExportKind,
  params: { from?: string; to?: string; vehicleId?: string },
) {
  const columns = COLUMNS_FOR[kind]
  const vehicles = await prisma.vehicle.findMany({ where: { workspaceId } })
  const byId = new Map(vehicles.map((v) => [v.id, v]))
  const nameOf = (id: string | null) => {
    if (!id) return null
    const v = byId.get(id)
    return v ? `${v.manufacturer} ${v.model}` : null
  }
  const regOf = (id: string | null) => (id ? (byId.get(id)?.registrationNumber ?? null) : null)

  const range = (field: string) =>
    params.from || params.to
      ? {
          [field]: {
            ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
            ...(params.to ? { lte: new Date(`${params.to}T00:00:00.000Z`) } : {}),
          },
        }
      : {}
  const vehicleFilter = params.vehicleId ? { vehicleId: params.vehicleId } : {}
  // A soft-deleted vehicle's records leave the exports with it, exactly as they leave the
  // reports (DECISIONS.md D-082).
  const liveVehicle = { OR: [{ vehicleId: null }, { vehicle: { deletedAt: null } }] }

  switch (kind) {
    case 'EXPENSES': {
      const rows = await prisma.expense.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...range('incurredOn'),
          ...vehicleFilter,
          ...liveVehicle,
        },
        orderBy: { incurredOn: 'desc' },
        include: { category: { select: { name: true } } },
      })
      return {
        columns,
        rows: rows.map((r) => ({
          incurredOn: dateStr(r.incurredOn as Date),
          category: (r.category as { name: string } | null)?.name ?? null,
          description: r.description as string | null,
          vendorName: r.vendorName as string | null,
          amount: dec(r.amount),
          currency: r.currency as string,
          vehicle: nameOf(r.vehicleId as string | null),
          registrationNumber: regOf(r.vehicleId as string | null),
          odometer: r.odometer as number | null,
          odometerUnit: r.odometerUnit as string | null,
          source: (r.sourceType as string | null) ?? 'MANUAL',
        })),
      }
    }
    case 'SERVICES': {
      const rows = await prisma.serviceRecord.findMany({
        where: { workspaceId, deletedAt: null, ...range('performedOn'), ...vehicleFilter },
        orderBy: { performedOn: 'desc' },
        include: { category: { select: { name: true } } },
      })
      return {
        columns,
        rows: rows.map((r) => ({
          performedOn: dateStr(r.performedOn as Date),
          vehicle: nameOf(r.vehicleId as string),
          registrationNumber: regOf(r.vehicleId as string),
          title: r.title as string,
          category: (r.category as { name: string } | null)?.name ?? null,
          provider: (r.workshopName as string | null) ?? null,
          odometer: r.odometer as number | null,
          odometerUnit: r.odometerUnit as string | null,
          partsTotal: dec(r.partsTotal),
          labourTotal: dec(r.labourTotal),
          totalAmount: dec(r.totalAmount),
          currency: r.currency as string,
          notes: r.notes as string | null,
        })),
      }
    }
    case 'FUEL': {
      const rows = await prisma.fuelEntry.findMany({
        where: { workspaceId, deletedAt: null, ...range('filledOn'), ...vehicleFilter },
        orderBy: { filledOn: 'desc' },
      })
      return {
        columns,
        rows: rows.map((r) => ({
          filledOn: dateStr(r.filledOn as Date),
          vehicle: nameOf(r.vehicleId as string),
          registrationNumber: regOf(r.vehicleId as string),
          odometer: r.odometer as number,
          odometerUnit: r.odometerUnit as string,
          quantity: atPlaces(r.quantity, 3) ?? '0',
          quantityUnit: r.quantityUnit as string,
          unitPrice: atPlaces(r.unitPrice, 4),
          totalAmount: dec(r.totalAmount),
          currency: r.currency as string,
          fullTank: r.isFullTank as boolean,
          missedFill: r.missedFill as boolean,
          station: r.stationName as string | null,
        })),
      }
    }
    case 'ODOMETER': {
      const rows = await prisma.odometerEntry.findMany({
        where: { workspaceId, ...range('recordedOn'), ...vehicleFilter },
        orderBy: { recordedOn: 'desc' },
      })
      return {
        columns,
        rows: rows.map((r) => ({
          recordedOn: dateStr(r.recordedOn as Date),
          vehicle: nameOf(r.vehicleId as string),
          registrationNumber: regOf(r.vehicleId as string),
          value: r.value as number,
          unit: r.unit as string,
          source: r.source as string,
          isCorrection: r.isCorrection as boolean,
          notes: r.notes as string | null,
        })),
      }
    }
    case 'VEHICLES': {
      const rows = vehicles.filter((v) => v.deletedAt === null)
      return {
        columns,
        rows: rows.map((v) => ({
          manufacturer: v.manufacturer,
          model: v.model,
          registrationNumber: v.registrationNumber,
          vin: (v.vin as string | null) ?? null,
          modelYear: (v.modelYear as number | null) ?? null,
          status: v.status as string,
          fuelType: (v.fuelType as string | null) ?? null,
          currentOdometer: (v.currentOdometer as number | null) ?? null,
          currentOdometerUnit: (v.currentOdometerUnit as string | null) ?? null,
          purchasedOn: v.purchasedOn ? dateStr(v.purchasedOn as Date) : null,
          purchasePrice: dec(v.purchasePrice),
          currency: (v.purchaseCurrency as string | null) ?? null,
        })),
      }
    }
  }
}
