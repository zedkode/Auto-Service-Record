import type { DistanceUnit, VehicleStatus, WorkspaceRole } from '@autoservices/types'

export interface ApiEnvelope<T> {
  data: T
  meta?: { total?: number; limit?: number; hasMore?: boolean; nextCursor?: string }
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    requestId: string
    details?: unknown
  }
}

export interface SessionUser {
  id: string
  email: string
  emailVerified: boolean
  displayName: string
  timezone: string
  preferredDistanceUnit: DistanceUnit
  preferredCurrency: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  type: string
  role: WorkspaceRole
  defaultCurrency: string
  defaultDistanceUnit: DistanceUnit
}

export interface SessionResponse {
  user: SessionUser
  workspaces: WorkspaceSummary[]
}

export type TrackingStatus = 'HEALTHY' | 'DUE_SOON' | 'ATTENTION' | 'OVERDUE' | 'UNKNOWN'

export interface VehicleSummary {
  id: string
  manufacturer: string
  model: string
  trim: string | null
  modelYear: number | null
  registrationNumber: string | null
  status: VehicleStatus
  colour: string | null
  fuelType: string | null
  currentOdometer: number | null
  currentOdometerUnit: DistanceUnit
  currentOdometerAt: string | null
  distanceUnit: DistanceUnit
  maintenanceStatus: TrackingStatus
  inspectionStatus: TrackingStatus
  nextService: { label: string; dueIn: string } | null
}

export interface VehicleDetail extends VehicleSummary {
  generation: string | null
  vin: string | null
  engineName: string | null
  engineCode: string | null
  displacementCc: number | null
  powerKw: number | null
  transmission: string | null
  drivetrain: string | null
  bodyType: string | null
  firstRegisteredOn: string | null
  purchasedOn: string | null
  purchasePrice: string | null
  purchaseCurrency: string | null
  notes: string | null
  createdAt: string
}

export interface OdometerEntry {
  id: string
  value: number
  unit: DistanceUnit
  recordedOn: string | null
  source: string
  isCorrection: boolean
  correctionReason: string | null
  notes: string | null
  createdAt: string
}

export interface CurrentOdometer {
  value: number | null
  unit: DistanceUnit
  recordedOn: string | null
  ageDays: number | null
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN'
}

export interface TimelineEvent {
  id: string
  type: string
  occurredOn: string
  title: string
  description: string | null
  odometer: { value: number; unit: DistanceUnit } | null
  amount: { amount: string; currency: string } | null
  refType: string
  refId: string
}

export interface AttentionItem {
  vehicleId: string
  vehicleName: string
  registrationNumber: string | null
  severity: TrackingStatus
  title: string
  detail: string
  action: { label: string; href: string }
}

export interface DashboardData {
  counts: {
    vehicles: number
    totalVehicles: number
    attention: number
    servicesDue: number
    overdue: number
  }
  attention: AttentionItem[]
  recentActivity: Array<{
    id: string
    type: string
    occurredOn: string
    title: string
    vehicleId: string
    vehicleName: string
  }>
  costs: {
    /** Null means nothing recorded, or amounts in more than one currency. Never zero. */
    thisMonth: string | null
    currency: string | null
    mixedCurrencies: boolean
    entries: number
  }
}

export interface WorkspaceDetail {
  id: string
  name: string
  type: string
  role: WorkspaceRole
  defaultCurrency: string
  defaultDistanceUnit: DistanceUnit
  timezone: string
  memberCount: number
  vehicleCount: number
  createdAt: string
}

export interface MemberSummary {
  id: string
  role: WorkspaceRole
  status: string
  joinedAt: string | null
  user: { id: string; email: string; displayName: string }
}

// --- service history ---------------------------------------------------------------

export interface ServiceCategory {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  defaultIntervalKm: number | null
  defaultIntervalMonths: number | null
}

export interface ServiceSummary {
  id: string
  performedOn: string | null
  odometer: number | null
  odometerUnit: DistanceUnit | null
  title: string
  workshopName: string | null
  totalAmount: string | null
  currency: string
  category: { id: string; name: string; key: string } | null
  vehicle: { id: string; manufacturer: string; model: string; registrationNumber: string | null }
  partCount: number
}

export interface ServicePart {
  id: string
  name: string
  brand: string | null
  manufacturer: string | null
  partNumber: string | null
  quantity: string
  unitPrice: string | null
  currency: string
  warrantyMonths: number | null
  supplierName: string | null
  notes: string | null
}

export interface ServiceDetail extends ServiceSummary {
  description: string | null
  mechanicName: string | null
  partsTotal: string | null
  labourTotal: string | null
  taxTotal: string | null
  warrantyMonths: number | null
  nextServiceOn: string | null
  nextServiceOdometer: number | null
  notes: string | null
  createdAt: string
  parts: ServicePart[]
}

export interface CostSummaryRow {
  currency: string
  total: string
  count: number
}

// --- maintenance -------------------------------------------------------------------

export type MaintenanceStatus = 'OK' | 'DUE_SOON' | 'DUE' | 'OVERDUE'
export type IntervalType = 'TIME_BASED' | 'DISTANCE_BASED' | 'COMBINED'

export interface MaintenanceRule {
  id: string
  vehicleId: string
  name: string
  category: { id: string; key: string; name: string } | null
  intervalType: IntervalType
  intervalDistance: number | null
  intervalDistanceUnit: DistanceUnit | null
  intervalMonths: number | null
  thresholdDistance: number | null
  thresholdDays: number | null
  lastCompletedOn: string | null
  lastCompletedOdometer: number | null
  isActive: boolean
  isUserOverridden: boolean
  notes: string | null
  /** Everything below is computed server-side. The UI renders it; it never recomputes. */
  status: MaintenanceStatus
  nextDueOn: string | null
  nextDueOdometer: number | null
  nextDueOdometerUnit: DistanceUnit | null
  daysRemaining: number | null
  distanceRemaining: number | null
  distanceRemainingUnit: DistanceUnit | null
  triggeringDimension: 'DATE' | 'DISTANCE' | null
  odometerConfidence: 'FRESH' | 'STALE' | 'UNKNOWN'
  summary: string
}

export interface DueMaintenanceItem extends MaintenanceRule {
  vehicle: {
    id: string
    manufacturer: string
    model: string
    registrationNumber: string | null
    distanceUnit: DistanceUnit
  }
}

export interface MaintenanceCompletion {
  id: string
  completedOn: string | null
  odometer: number | null
  odometerUnit: DistanceUnit | null
  serviceRecordId: string | null
  notes: string | null
}

// --- reminders and notifications ----------------------------------------------------

export type ReminderStatus =
  | 'SCHEDULED'
  | 'DUE'
  | 'SENT'
  | 'SNOOZED'
  | 'DISMISSED'
  | 'COMPLETED'
  | 'CANCELLED'

export interface Reminder {
  /** Computed server-side; the UI groups by this rather than doing date maths. */
  bucket: 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'HANDLED'
  daysRemaining: number | null
  id: string
  sourceType: string
  sourceId: string | null
  vehicle: {
    id: string
    manufacturer: string
    model: string
    registrationNumber: string | null
  } | null
  title: string
  body: string | null
  dueOn: string | null
  dueOdometer: number | null
  dueOdometerUnit: DistanceUnit | null
  status: ReminderStatus
  snoozedUntil: string | null
  overdue: boolean
  actionUrl: string | null
}

export interface ReminderSummary {
  total: number
  overdue: number
  dueSoon: number
}

export interface AppNotification {
  id: string
  category: string
  title: string
  body: string | null
  actionUrl: string | null
  vehicleId: string | null
  reminderId: string | null
  workspace: { id: string; name: string }
  readAt: string | null
  createdAt: string
}

export interface NotificationPreference {
  category: string
  email: boolean
  inApp: boolean
}

// --- ownership modules (OWN-001/002/003) ---

export type InspectionType =
  | 'MOT'
  | 'ITP'
  | 'TUV'
  | 'CT'
  | 'STATE_INSPECTION'
  | 'EMISSIONS'
  | 'OTHER'
export type InspectionResult = 'PASS' | 'PASS_WITH_ADVISORIES' | 'FAIL' | 'UNKNOWN'
export type AdvisorySeverity = 'MINOR' | 'MAJOR' | 'DANGEROUS'
export type PaymentFrequency = 'ONE_OFF' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL'
export type PolicyRenewalType = 'MANUAL' | 'AUTOMATIC' | 'UNKNOWN'

/** Computed by the server, never in the browser (DECISIONS.md D-041). */
export type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'VALID' | 'NONE'

export interface Advisory {
  id: string
  severity: AdvisorySeverity
  text: string
  isResolved: boolean
  resolvedAt: string | null
  resolvedServiceRecordId: string | null
}

export interface Inspection {
  id: string
  vehicleId: string
  inspectionType: InspectionType
  result: InspectionResult
  performedOn: string | null
  expiresOn: string | null
  odometer: number | null
  odometerUnit: DistanceUnit | null
  centreName: string | null
  certificateNumber: string | null
  notes: string | null
  expiryStatus: ExpiryStatus
  daysRemaining: number | null
  advisories: Advisory[]
  unresolvedAdvisories: number
  createdAt: string
}

/**
 * Monetary fields are ABSENT, not null, for a caller without financial visibility — a
 * DRIVER sees that cover exists without seeing the premium. Optional here for that
 * reason, never because the value might be missing.
 */
export interface InsurancePolicy {
  id: string
  vehicleId: string
  providerName: string
  policyNumber: string | null
  coverType: string | null
  startsOn: string | null
  expiresOn: string | null
  premiumAmount?: string | null
  excessAmount?: string | null
  currency?: string
  paymentFrequency?: PaymentFrequency | null
  expiryStatus: ExpiryStatus
  daysRemaining: number | null
  renewalType: PolicyRenewalType
  coverageNotes: string | null
  createdAt: string
}

export interface RoadTaxRecord {
  id: string
  vehicleId: string
  countryCode: string
  taxType: string | null
  reference: string | null
  startsOn: string | null
  expiresOn: string | null
  amount?: string | null
  currency?: string
  paymentFrequency?: PaymentFrequency | null
  expiryStatus: ExpiryStatus
  daysRemaining: number | null
  notes: string | null
  createdAt: string
}

export interface Expense {
  id: string
  vehicleId: string | null
  vehicleName: string | null
  categoryId: string | null
  categoryKey: string | null
  categoryName: string | null
  incurredOn: string | null
  amount: string | null
  currency: string
  vendorName: string | null
  odometer: number | null
  odometerUnit: DistanceUnit | null
  description: string | null
  sourceType: 'MANUAL' | 'SERVICE' | 'FUEL' | 'INSURANCE' | 'TAX' | 'OTHER'
  sourceRecordId: string | null
  /** Projected rows mirror another record and cannot be edited here (DECISIONS.md D-055). */
  isProjected: boolean
  createdAt: string
}

export interface ExpenseCategory {
  id: string
  key: string
  name: string
  isSystem: boolean
}

export interface ExpenseSummary {
  from: string
  to: string
  total: string
  currency: string | null
  mixedCurrencies: boolean
  entries: number
  byCategory: Array<{ key: string; name: string; total: string; count: number }>
  byVehicle: Array<{ vehicleId: string | null; name: string; total: string; count: number }>
}

// --- documents (DOC-101…106) ---

export type DocumentType =
  | 'INVOICE'
  | 'RECEIPT'
  | 'INSURANCE_POLICY'
  | 'INSPECTION_CERTIFICATE'
  | 'REGISTRATION'
  | 'WARRANTY'
  | 'MANUAL'
  | 'PHOTO'
  | 'OTHER'

export interface VaultDocument {
  id: string
  vehicleId: string | null
  filename: string
  contentType: string
  byteSize: number
  documentType: DocumentType
  title: string | null
  documentDate: string | null
  expiresOn: string | null
  attachedToType: string | null
  attachedToId: string | null
  status: 'PENDING' | 'AVAILABLE' | 'QUARANTINED' | 'DELETED'
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED'
  createdAt: string
}

export interface UploadSession {
  documentId: string
  upload: {
    url: string
    method: 'PUT'
    headers: Record<string, string>
    expiresInSeconds: number
  }
}

export interface DownloadLink {
  url: string
  expiresInSeconds: number
}

// --- membership (WS-002/003/004) ---

export interface Invitation {
  id: string
  email: string
  role: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
  /** The token is never returned by the API: it exists only in the email. */
}

export interface InvitationPreview {
  workspaceName: string
  role: string
  email: string
  expiresAt: string
}

// --- fuel (OWN-006) ---

export type QuantityUnit = 'LITRES' | 'US_GALLONS' | 'IMP_GALLONS' | 'KWH'

export interface FuelEntry {
  id: string
  vehicleId: string
  filledOn: string | null
  odometer: number
  odometerUnit: DistanceUnit
  quantity: number
  quantityUnit: QuantityUnit
  totalAmount: string | null
  unitPrice: string | null
  currency: string
  fuelType: string | null
  isFullTank: boolean
  missedFill: boolean
  stationName: string | null
  notes: string | null
  createdAt: string
}

export interface EconomyInterval {
  fromFillId: string
  toFillId: string
  fromOdometer: number
  toOdometer: number
  distanceMetres: number
  quantity: number
  electric: boolean
  fillCount: number
  litresPer100Km: number | null
  kmPerLitre: number | null
  milesPerImperialGallon: number | null
  kwhPer100Km: number | null
  milesPerKwh: number | null
}

export interface FuelEconomy {
  intervals: EconomyInterval[]
  skipped: Array<{ fromFillId: string; toFillId: string; reason: string }>
  /** Null until two full fills exist. The reason says why (DECISIONS.md D-002). */
  average:
    | (Omit<
        EconomyInterval,
        'fromFillId' | 'toFillId' | 'fromOdometer' | 'toOdometer' | 'fillCount'
      > & {
        distanceMetres: number
        quantity: number
      })
    | null
  unavailableReason: 'NO_FILLS' | 'ONE_FULL_FILL' | 'NO_USABLE_INTERVAL' | null
  fillCount: number
}

// --- reports (RPT-001/002) ---

export interface CostReport {
  from: string
  to: string
  days: number
  total: string
  currency: string | null
  mixedCurrencies: boolean
  entries: number
  byCategory: Array<{ key: string; name: string; total: string; count: number; share: number }>
  byVehicle: Array<{
    vehicleId: string | null
    name: string
    total: string
    count: number
    share: number
  }>
  byMonth: Array<{ month: string; total: string; count: number }>
  distance: {
    metres: number | null
    miles: number | null
    kilometres: number | null
    unavailableReason: 'NO_READINGS' | 'ONE_READING' | 'NO_MOVEMENT' | null
  }
  costPerDistance: {
    perMile: string | null
    perKilometre: string | null
    unavailableReason: 'NO_READINGS' | 'ONE_READING' | 'NO_MOVEMENT' | 'MIXED_CURRENCIES' | null
  }
  costPerYear: {
    amount: string | null
    /** True when the period is shorter than a year, so the figure is a projection. */
    projected: boolean
    unavailableReason: 'PERIOD_TOO_SHORT' | 'MIXED_CURRENCIES' | null
  }
}
