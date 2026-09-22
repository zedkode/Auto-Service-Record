/**
 * EXP-002 — gathers everything one vehicle's history document needs.
 *
 * Separate from the layout so the PDF builder is a pure function of plain data: a document
 * whose content depends on a live database is one you can only check by looking at it.
 */
import type { VehicleHistory } from './vehicle-history.pdf.js'

interface HistoryPrisma {
  vehicle: { findFirst(args: unknown): Promise<Record<string, unknown> | null> }
  workspace: { findFirst(args: unknown): Promise<{ name: string } | null> }
  serviceRecord: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  vehicleInspection: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  odometerEntry: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  warranty: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  document: { findMany(args: unknown): Promise<Record<string, unknown>[]> }
  fuelEntry: {
    count(args: unknown): Promise<number>
    findFirst(args: unknown): Promise<Record<string, unknown> | null>
  }
}

const dateStr = (d: unknown) =>
  d instanceof Date
    ? d.toISOString().slice(0, 10)
    : d === null || d === undefined
      ? null
      : String(d)
const dec = (v: unknown) =>
  v === null || v === undefined
    ? null
    : typeof v === 'object' && 'toFixed' in (v as object)
      ? (v as { toFixed(n: number): string }).toFixed(2)
      : String(v)

export async function collectVehicleHistory(
  prisma: HistoryPrisma,
  workspaceId: string,
  vehicleId: string,
  generatedOn: string,
): Promise<VehicleHistory> {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId, deletedAt: null },
  })
  if (!vehicle) throw new Error(`vehicle ${vehicleId} not found in workspace ${workspaceId}`)

  const [
    workspace,
    services,
    inspections,
    odometer,
    warranties,
    documents,
    fills,
    firstFill,
    lastFill,
  ] = await Promise.all([
    prisma.workspace.findFirst({ where: { id: workspaceId }, select: { name: true } }),
    prisma.serviceRecord.findMany({
      where: { vehicleId, workspaceId, deletedAt: null },
      orderBy: { performedOn: 'desc' },
      include: { category: { select: { name: true } }, parts: true },
    }),
    prisma.vehicleInspection.findMany({
      where: { vehicleId, workspaceId, deletedAt: null },
      orderBy: { performedOn: 'desc' },
      include: { advisories: true },
    }),
    prisma.odometerEntry.findMany({
      where: { vehicleId, workspaceId },
      orderBy: { recordedOn: 'desc' },
    }),
    prisma.warranty.findMany({
      where: { vehicleId, workspaceId, deletedAt: null },
      orderBy: { startsOn: 'desc' },
    }),
    prisma.document.findMany({
      // AVAILABLE only: a PENDING upload has no confirmed object behind it, and a
      // QUARANTINED one failed a scan. Neither belongs in a history handed to a buyer.
      where: { vehicleId, workspaceId, deletedAt: null, status: 'AVAILABLE' },
      orderBy: { documentDate: 'desc' },
      /**
       * Names and dates only. `storageKey` and `originalFilename` are deliberately NOT
       * selected: the key is the thing a signed URL is built from, and this document is
       * handed to a stranger.
       */
      select: { title: true, documentType: true, documentDate: true, originalFilename: false },
    }),
    prisma.fuelEntry.count({ where: { vehicleId, workspaceId, deletedAt: null } }),
    prisma.fuelEntry.findFirst({
      where: { vehicleId, workspaceId, deletedAt: null },
      orderBy: { filledOn: 'asc' },
      select: { filledOn: true },
    }),
    prisma.fuelEntry.findFirst({
      where: { vehicleId, workspaceId, deletedAt: null },
      orderBy: { filledOn: 'desc' },
      select: { filledOn: true },
    }),
  ])

  return {
    workspaceName: workspace?.name ?? 'AutoServices',
    generatedOn,
    vehicle: {
      manufacturer: String(vehicle.manufacturer),
      model: String(vehicle.model),
      trim: (vehicle.trim as string | null) ?? null,
      modelYear: (vehicle.modelYear as number | null) ?? null,
      registrationNumber: (vehicle.registrationNumber as string | null) ?? null,
      vin: (vehicle.vin as string | null) ?? null,
      colour: (vehicle.colour as string | null) ?? null,
      fuelType: (vehicle.fuelType as string | null) ?? null,
      transmission: (vehicle.transmission as string | null) ?? null,
      currentOdometer: (vehicle.currentOdometer as number | null) ?? null,
      currentOdometerUnit: (vehicle.currentOdometerUnit as string | null) ?? null,
      purchasedOn: dateStr(vehicle.purchasedOn),
      status: String(vehicle.status),
    },
    services: services.map((s) => ({
      performedOn: dateStr(s.performedOn)!,
      title: String(s.title),
      category: (s.category as { name: string } | null)?.name ?? null,
      workshopName: (s.workshopName as string | null) ?? null,
      odometer: (s.odometer as number | null) ?? null,
      odometerUnit: (s.odometerUnit as string | null) ?? null,
      totalAmount: dec(s.totalAmount),
      currency: String(s.currency ?? 'GBP'),
      notes: (s.notes as string | null) ?? null,
      parts: ((s.parts as Array<Record<string, unknown>>) ?? []).map((p) => ({
        name: String(p.name),
        brand: (p.brand as string | null) ?? null,
        partNumber: (p.partNumber as string | null) ?? null,
      })),
    })),
    inspections: inspections.map((i) => ({
      performedOn: dateStr(i.performedOn)!,
      expiresOn: dateStr(i.expiresOn),
      inspectionType: String(i.inspectionType),
      result: String(i.result),
      centreName: (i.centreName as string | null) ?? null,
      odometer: (i.odometer as number | null) ?? null,
      advisories: ((i.advisories as Array<Record<string, unknown>>) ?? []).map((a) => ({
        severity: String(a.severity),
        // The column is `text`, and resolution is the boolean `is_resolved`. Reading
        // `description`/`resolvedAt` put the literal string "undefined" in front of a
        // buyer — caught by reading the rendered PDF, not by reading the code.
        description: String(a.text),
        resolved: Boolean(a.isResolved),
      })),
    })),
    odometer: odometer.map((o) => ({
      recordedOn: dateStr(o.recordedOn)!,
      value: o.value as number,
      unit: String(o.unit),
      isCorrection: Boolean(o.isCorrection),
    })),
    warranties: warranties.map((w) => ({
      warrantyType: String(w.warrantyType),
      providerName: (w.providerName as string | null) ?? null,
      startsOn: dateStr(w.startsOn)!,
      expiresOn: dateStr(w.expiresOn),
      distanceLimit: (w.distanceLimit as number | null) ?? null,
      distanceLimitUnit: (w.distanceLimitUnit as string | null) ?? null,
    })),
    documents: documents.map((d) => ({
      // A document with no title is listed by its type rather than as a blank line.
      title: (d.title as string | null) ?? String(d.documentType).replace(/_/g, ' '),
      kind: String(d.documentType),
      issuedOn: dateStr(d.documentDate),
    })),
    fuelSummary: {
      fills,
      firstOn: dateStr(firstFill?.filledOn),
      lastOn: dateStr(lastFill?.filledOn),
    },
  }
}
