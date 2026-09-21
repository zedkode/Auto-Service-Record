import type { CalendarDate, DistanceUnit } from '@autoservices/types'

/**
 * REMINDER ENGINE — pluggable sources (ARCHITECTURE.md §8, task brief §26/§27).
 *
 * One engine, many sources. A source knows how to find its own due-dated things; the
 * engine owns scheduling, deduplication, state transitions and delivery. Adding
 * inspections or insurance later means adding a collector, NOT touching the engine.
 */
export type ReminderSourceType =
  | 'MAINTENANCE'
  | 'INSPECTION'
  | 'INSURANCE'
  | 'TAX'
  | 'WARRANTY'
  | 'DOCUMENT'
  | 'SERVICE'
  | 'TYRE'
  | 'ODOMETER_STALE'
  | 'CUSTOM'

export type ReminderStatus =
  | 'SCHEDULED'
  | 'DUE'
  | 'SENT'
  | 'SNOOZED'
  | 'DISMISSED'
  | 'COMPLETED'
  | 'CANCELLED'

export type NotificationCategory =
  | 'ACCOUNT'
  | 'SECURITY'
  | 'MAINTENANCE'
  | 'INSPECTION'
  | 'INSURANCE'
  | 'TAX'
  | 'WARRANTY'
  | 'DOCUMENT'
  | 'DIGEST'
  | 'PRODUCT_UPDATES'

/** What a source reports. The engine turns these into reminders. */
export interface ReminderCandidate {
  sourceType: ReminderSourceType
  sourceId: string
  vehicleId: string | null
  title: string
  body: string | null
  dueOn: CalendarDate | null
  dueOdometer: number | null
  dueOdometerUnit: DistanceUnit | null
  category: NotificationCategory
  /** Where the notification's action button points. */
  actionPath: string
  /** True when the source is already past due, regardless of the date maths. */
  alreadyOverdue?: boolean
  /** Current odometer, so mileage windows can be evaluated. */
  currentOdometer?: number | null
}

export interface ScanContext {
  workspaceId: string
  today: CalendarDate
}

export interface ReminderSource {
  readonly type: ReminderSourceType
  scan(ctx: ScanContext): Promise<ReminderCandidate[]>
}
