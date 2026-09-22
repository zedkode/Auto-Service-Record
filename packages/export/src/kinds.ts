/**
 * EXP-001 — what can be exported, and which columns each export carries.
 *
 * The column sets live here, beside the serialiser, so the API's validation and the
 * worker's file share one definition. A kind the API accepts but the worker cannot build
 * would be a job that fails after the user has already been told it was accepted.
 */
import type { Column } from './csv.js'

export const EXPORT_KINDS = ['EXPENSES', 'SERVICES', 'FUEL', 'ODOMETER', 'VEHICLES'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

export const EXPORT_FORMATS = ['CSV', 'JSON'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/** Kinds whose rows are filtered by a date range; the rest export everything. */
export const DATE_FILTERED: ReadonlySet<ExportKind> = new Set<ExportKind>([
  'EXPENSES',
  'SERVICES',
  'FUEL',
  'ODOMETER',
])

export interface ExpenseRow {
  incurredOn: string
  category: string | null
  description: string | null
  vendorName: string | null
  amount: string
  currency: string
  vehicle: string | null
  registrationNumber: string | null
  odometer: number | null
  odometerUnit: string | null
  source: string
}

export interface ServiceRow {
  performedOn: string
  vehicle: string | null
  registrationNumber: string | null
  title: string
  category: string | null
  provider: string | null
  odometer: number | null
  odometerUnit: string | null
  partsTotal: string | null
  labourTotal: string | null
  totalAmount: string | null
  currency: string
  notes: string | null
}

export interface FuelRow {
  filledOn: string
  vehicle: string | null
  registrationNumber: string | null
  odometer: number
  odometerUnit: string
  quantity: string
  quantityUnit: string
  unitPrice: string | null
  totalAmount: string | null
  currency: string
  fullTank: boolean
  missedFill: boolean
  station: string | null
}

export interface OdometerRow {
  recordedOn: string
  vehicle: string | null
  registrationNumber: string | null
  value: number
  unit: string
  source: string
  isCorrection: boolean
  notes: string | null
}

export interface VehicleRow {
  manufacturer: string
  model: string
  registrationNumber: string | null
  vin: string | null
  modelYear: number | null
  status: string
  fuelType: string | null
  currentOdometer: number | null
  currentOdometerUnit: string | null
  purchasedOn: string | null
  purchasePrice: string | null
  currency: string | null
}

/**
 * Money stays a string all the way out. Parsing a decimal into a float to format it would
 * reintroduce exactly the error the Decimal column exists to prevent (AGENTS.md: never
 * `number` arithmetic on prices).
 */
export const EXPENSE_COLUMNS: ReadonlyArray<Column<ExpenseRow>> = [
  { header: 'Date', value: (r) => r.incurredOn },
  { header: 'Category', value: (r) => r.category },
  { header: 'Description', value: (r) => r.description },
  { header: 'Vendor', value: (r) => r.vendorName },
  { header: 'Amount', value: (r) => r.amount },
  { header: 'Currency', value: (r) => r.currency },
  { header: 'Vehicle', value: (r) => r.vehicle },
  { header: 'Registration', value: (r) => r.registrationNumber },
  { header: 'Odometer', value: (r) => r.odometer },
  { header: 'Odometer unit', value: (r) => r.odometerUnit },
  { header: 'Source', value: (r) => r.source },
]

export const SERVICE_COLUMNS: ReadonlyArray<Column<ServiceRow>> = [
  { header: 'Date', value: (r) => r.performedOn },
  { header: 'Vehicle', value: (r) => r.vehicle },
  { header: 'Registration', value: (r) => r.registrationNumber },
  { header: 'Title', value: (r) => r.title },
  { header: 'Category', value: (r) => r.category },
  { header: 'Provider', value: (r) => r.provider },
  { header: 'Odometer', value: (r) => r.odometer },
  { header: 'Odometer unit', value: (r) => r.odometerUnit },
  { header: 'Parts', value: (r) => r.partsTotal },
  { header: 'Labour', value: (r) => r.labourTotal },
  { header: 'Total', value: (r) => r.totalAmount },
  { header: 'Currency', value: (r) => r.currency },
  { header: 'Notes', value: (r) => r.notes },
]

export const FUEL_COLUMNS: ReadonlyArray<Column<FuelRow>> = [
  { header: 'Date', value: (r) => r.filledOn },
  { header: 'Vehicle', value: (r) => r.vehicle },
  { header: 'Registration', value: (r) => r.registrationNumber },
  { header: 'Odometer', value: (r) => r.odometer },
  { header: 'Odometer unit', value: (r) => r.odometerUnit },
  { header: 'Quantity', value: (r) => r.quantity },
  { header: 'Quantity unit', value: (r) => r.quantityUnit },
  { header: 'Unit price', value: (r) => r.unitPrice },
  { header: 'Total', value: (r) => r.totalAmount },
  { header: 'Currency', value: (r) => r.currency },
  { header: 'Full tank', value: (r) => r.fullTank },
  { header: 'Missed fill', value: (r) => r.missedFill },
  { header: 'Station', value: (r) => r.station },
]

export const ODOMETER_COLUMNS: ReadonlyArray<Column<OdometerRow>> = [
  { header: 'Date', value: (r) => r.recordedOn },
  { header: 'Vehicle', value: (r) => r.vehicle },
  { header: 'Registration', value: (r) => r.registrationNumber },
  { header: 'Reading', value: (r) => r.value },
  { header: 'Unit', value: (r) => r.unit },
  { header: 'Source', value: (r) => r.source },
  { header: 'Correction', value: (r) => r.isCorrection },
  { header: 'Notes', value: (r) => r.notes },
]

export const VEHICLE_COLUMNS: ReadonlyArray<Column<VehicleRow>> = [
  { header: 'Manufacturer', value: (r) => r.manufacturer },
  { header: 'Model', value: (r) => r.model },
  { header: 'Registration', value: (r) => r.registrationNumber },
  { header: 'VIN', value: (r) => r.vin },
  { header: 'Year', value: (r) => r.modelYear },
  { header: 'Status', value: (r) => r.status },
  { header: 'Fuel type', value: (r) => r.fuelType },
  { header: 'Current odometer', value: (r) => r.currentOdometer },
  { header: 'Odometer unit', value: (r) => r.currentOdometerUnit },
  { header: 'Purchased on', value: (r) => r.purchasedOn },
  { header: 'Purchase price', value: (r) => r.purchasePrice },
  { header: 'Currency', value: (r) => r.currency },
]

export const COLUMNS_FOR: Record<ExportKind, ReadonlyArray<Column<never>>> = {
  EXPENSES: EXPENSE_COLUMNS as ReadonlyArray<Column<never>>,
  SERVICES: SERVICE_COLUMNS as ReadonlyArray<Column<never>>,
  FUEL: FUEL_COLUMNS as ReadonlyArray<Column<never>>,
  ODOMETER: ODOMETER_COLUMNS as ReadonlyArray<Column<never>>,
  VEHICLES: VEHICLE_COLUMNS as ReadonlyArray<Column<never>>,
}

const LABEL: Record<ExportKind, string> = {
  EXPENSES: 'expenses',
  SERVICES: 'service-history',
  FUEL: 'fuel',
  ODOMETER: 'mileage',
  VEHICLES: 'vehicles',
}

/**
 * The name the user's browser will save. Dated, because an accountant ends up with several
 * of these in one folder and `expenses.csv` twice is a support ticket.
 */
export function exportFilename(kind: ExportKind, format: ExportFormat, generatedOn: string) {
  return `autoservices-${LABEL[kind]}-${generatedOn}.${format.toLowerCase()}`
}

export const CONTENT_TYPE: Record<ExportFormat, string> = {
  CSV: 'text/csv; charset=utf-8',
  JSON: 'application/json; charset=utf-8',
}
