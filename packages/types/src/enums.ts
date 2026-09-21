/**
 * Domain enums. These mirror the PostgreSQL enums defined in the Prisma schema —
 * see DATABASE.md §4. Kept as const objects plus union types so they are usable in
 * the browser without importing the Prisma client.
 */

export const WorkspaceType = {
  PERSONAL: 'PERSONAL',
  FAMILY: 'FAMILY',
  BUSINESS: 'BUSINESS',
  FLEET: 'FLEET',
  CLUB: 'CLUB',
  OTHER: 'OTHER',
} as const
export type WorkspaceType = (typeof WorkspaceType)[keyof typeof WorkspaceType]

export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  DRIVER: 'DRIVER',
  VIEWER: 'VIEWER',
} as const
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole]

export const MemberStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
  REMOVED: 'REMOVED',
} as const
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus]

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  SUSPENDED: 'SUSPENDED',
  DELETION_REQUESTED: 'DELETION_REQUESTED',
  DELETED: 'DELETED',
} as const
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]

export const VehicleStatus = {
  ACTIVE: 'ACTIVE',
  STORED: 'STORED',
  SOLD: 'SOLD',
  SCRAPPED: 'SCRAPPED',
  ARCHIVED: 'ARCHIVED',
} as const
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus]

export const FuelType = {
  PETROL: 'PETROL',
  DIESEL: 'DIESEL',
  HYBRID: 'HYBRID',
  PLUGIN_HYBRID: 'PLUGIN_HYBRID',
  ELECTRIC: 'ELECTRIC',
  LPG: 'LPG',
  CNG: 'CNG',
  HYDROGEN: 'HYDROGEN',
  OTHER: 'OTHER',
} as const
export type FuelType = (typeof FuelType)[keyof typeof FuelType]

export const Transmission = {
  MANUAL: 'MANUAL',
  AUTOMATIC: 'AUTOMATIC',
  SEMI_AUTOMATIC: 'SEMI_AUTOMATIC',
  CVT: 'CVT',
  DCT: 'DCT',
  OTHER: 'OTHER',
} as const
export type Transmission = (typeof Transmission)[keyof typeof Transmission]

export const Drivetrain = {
  FWD: 'FWD',
  RWD: 'RWD',
  AWD: 'AWD',
  FOUR_WD: 'FOUR_WD',
  OTHER: 'OTHER',
} as const
export type Drivetrain = (typeof Drivetrain)[keyof typeof Drivetrain]

export const DistanceUnit = {
  MILES: 'MILES',
  KILOMETERS: 'KILOMETERS',
} as const
export type DistanceUnit = (typeof DistanceUnit)[keyof typeof DistanceUnit]

export const OdometerSource = {
  MANUAL: 'MANUAL',
  SERVICE: 'SERVICE',
  FUEL: 'FUEL',
  INSPECTION: 'INSPECTION',
  IMPORT: 'IMPORT',
  API: 'API',
} as const
export type OdometerSource = (typeof OdometerSource)[keyof typeof OdometerSource]

export const MaintenanceStatus = {
  OK: 'OK',
  DUE_SOON: 'DUE_SOON',
  DUE: 'DUE',
  OVERDUE: 'OVERDUE',
} as const
export type MaintenanceStatus = (typeof MaintenanceStatus)[keyof typeof MaintenanceStatus]

/** Distinct from OK: "not tracked" is not the same as "healthy". See UI_UX.md §6. */
export const TrackingStatus = {
  HEALTHY: 'HEALTHY',
  DUE_SOON: 'DUE_SOON',
  ATTENTION: 'ATTENTION',
  OVERDUE: 'OVERDUE',
  UNKNOWN: 'UNKNOWN',
} as const
export type TrackingStatus = (typeof TrackingStatus)[keyof typeof TrackingStatus]

export const TimelineEventType = {
  VEHICLE_ADDED: 'VEHICLE_ADDED',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SERVICE: 'SERVICE',
  REPAIR: 'REPAIR',
  INSPECTION: 'INSPECTION',
  ODOMETER: 'ODOMETER',
  INSURANCE: 'INSURANCE',
  TAX: 'TAX',
  WARRANTY: 'WARRANTY',
  TYRE: 'TYRE',
  FUEL: 'FUEL',
  EXPENSE: 'EXPENSE',
  DOCUMENT: 'DOCUMENT',
  NOTE: 'NOTE',
} as const
export type TimelineEventType = (typeof TimelineEventType)[keyof typeof TimelineEventType]

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  // Declared from day one; no transport registered yet. See ARCHITECTURE.md §9.
  PUSH: 'PUSH',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
} as const
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const AuditActorType = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const
export type AuditActorType = (typeof AuditActorType)[keyof typeof AuditActorType]
