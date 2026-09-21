/**
 * MAINTENANCE ENGINE (MNT-001) — ARCHITECTURE.md §6.
 *
 * Pure functions over plain inputs. No database, no clock, no I/O: the current time is
 * an argument, so every case is reproducible and the whole thing can be tested
 * exhaustively. The server owns these calculations; the frontend renders the result and
 * never recomputes it (AGENTS.md, CLAUDE.md).
 *
 * All distance arithmetic happens in METRES (integer) so a rule recorded in kilometres
 * and an odometer recorded in miles compare correctly.
 */
import {
  addMonths,
  calendarDate,
  daysBetween,
  toMetres,
  fromMetres,
  type CalendarDate,
  type DistanceUnit,
} from '@autoservices/types'

export type MaintenanceStatus = 'OK' | 'DUE_SOON' | 'DUE' | 'OVERDUE'
export type IntervalType = 'TIME_BASED' | 'DISTANCE_BASED' | 'COMBINED'
export type TriggeringDimension = 'DATE' | 'DISTANCE' | null
export type OdometerConfidence = 'FRESH' | 'STALE' | 'UNKNOWN'

/** A reading older than this makes distance projections a guess, and we say so. */
export const ODOMETER_STALE_DAYS = 45

/** Defaults when a rule does not override them. */
export const DEFAULT_THRESHOLD_DAYS = 30
export const DEFAULT_THRESHOLD_MILES = 500
export const DEFAULT_THRESHOLD_KM = 800

export interface MaintenanceRuleInput {
  intervalType: IntervalType
  intervalDistance: number | null
  intervalDistanceUnit: DistanceUnit | null
  intervalMonths: number | null
  thresholdDistance: number | null
  thresholdDays: number | null
  lastCompletedOn: CalendarDate | null
  lastCompletedOdometer: number | null
  lastCompletedUnit: DistanceUnit | null
}

export interface OdometerReading {
  value: number
  unit: DistanceUnit
  recordedOn: CalendarDate
}

export interface MaintenanceState {
  status: MaintenanceStatus
  nextDueOn: CalendarDate | null
  nextDueOdometer: number | null
  nextDueOdometerUnit: DistanceUnit | null
  daysRemaining: number | null
  distanceRemaining: number | null
  distanceRemainingUnit: DistanceUnit | null
  /** Which dimension reached its limit first. */
  triggeringDimension: TriggeringDimension
  odometerConfidence: OdometerConfidence
  /** Human-facing summary, e.g. "due in 620 miles" or "overdue by 12 days". */
  summary: string
}

function thresholdMetres(rule: MaintenanceRuleInput, unit: DistanceUnit): number {
  if (rule.thresholdDistance !== null) {
    return toMetres({ value: rule.thresholdDistance, unit })
  }
  return toMetres({
    value: unit === 'MILES' ? DEFAULT_THRESHOLD_MILES : DEFAULT_THRESHOLD_KM,
    unit,
  })
}

/**
 * Computes the state of one maintenance rule.
 *
 * For a COMBINED rule the effective due point is whichever dimension is reached first —
 * "every 12 months OR 10,000 miles, whichever comes first".
 */
export function evaluateRule(
  rule: MaintenanceRuleInput,
  odometer: OdometerReading | null,
  today: CalendarDate,
): MaintenanceState {
  const usesDate =
    (rule.intervalType === 'TIME_BASED' || rule.intervalType === 'COMBINED') &&
    rule.intervalMonths !== null &&
    rule.intervalMonths > 0
  const usesDistance =
    (rule.intervalType === 'DISTANCE_BASED' || rule.intervalType === 'COMBINED') &&
    rule.intervalDistance !== null &&
    rule.intervalDistance > 0

  const unit: DistanceUnit =
    rule.intervalDistanceUnit ?? odometer?.unit ?? rule.lastCompletedUnit ?? 'MILES'

  // ---- date dimension -------------------------------------------------------------
  let nextDueOn: CalendarDate | null = null
  let daysRemaining: number | null = null
  if (usesDate && rule.lastCompletedOn) {
    nextDueOn = addMonths(rule.lastCompletedOn, rule.intervalMonths!)
    daysRemaining = daysBetween(today, nextDueOn)
  }

  // ---- distance dimension ---------------------------------------------------------
  let nextDueOdometer: number | null = null
  let distanceRemaining: number | null = null
  let confidence: OdometerConfidence = 'UNKNOWN'

  if (usesDistance && rule.lastCompletedOdometer !== null) {
    const lastMetres = toMetres({
      value: rule.lastCompletedOdometer,
      unit: rule.lastCompletedUnit ?? unit,
    })
    const intervalMetres = toMetres({ value: rule.intervalDistance!, unit })
    const dueMetres = lastMetres + intervalMetres
    nextDueOdometer = fromMetres(dueMetres as never, unit).value

    if (odometer) {
      const currentMetres = toMetres({ value: odometer.value, unit: odometer.unit })
      distanceRemaining = fromMetres((dueMetres - currentMetres) as never, unit).value
      const age = daysBetween(odometer.recordedOn, today)
      confidence = age > ODOMETER_STALE_DAYS ? 'STALE' : 'FRESH'
    }
  }

  // ---- combine --------------------------------------------------------------------
  const dateStatus =
    daysRemaining === null ? null : statusFromDays(daysRemaining, rule.thresholdDays)
  const distanceStatus =
    distanceRemaining === null
      ? null
      : statusFromDistance(
          toMetres({ value: distanceRemaining, unit }),
          thresholdMetres(rule, unit),
        )

  // Whichever dimension is worse decides — "whichever comes first".
  const status = worst(dateStatus, distanceStatus)
  const triggeringDimension: TriggeringDimension =
    status === 'OK'
      ? null
      : rank(distanceStatus) > rank(dateStatus)
        ? 'DISTANCE'
        : dateStatus === null
          ? 'DISTANCE'
          : 'DATE'

  return {
    status,
    nextDueOn,
    nextDueOdometer,
    nextDueOdometerUnit: nextDueOdometer === null ? null : unit,
    daysRemaining,
    distanceRemaining,
    distanceRemainingUnit: distanceRemaining === null ? null : unit,
    triggeringDimension,
    odometerConfidence: confidence,
    summary: describe({
      status,
      daysRemaining,
      distanceRemaining,
      unit,
      triggeringDimension,
      confidence,
      hasAnyDimension: usesDate || usesDistance,
      completed: rule.lastCompletedOn !== null || rule.lastCompletedOdometer !== null,
    }),
  }
}

function statusFromDays(daysRemaining: number, thresholdDays: number | null): MaintenanceStatus {
  const threshold = thresholdDays ?? DEFAULT_THRESHOLD_DAYS
  if (daysRemaining < 0) return 'OVERDUE'
  if (daysRemaining === 0) return 'DUE'
  return daysRemaining <= threshold ? 'DUE_SOON' : 'OK'
}

function statusFromDistance(
  remainingMetres: number,
  thresholdMetresValue: number,
): MaintenanceStatus {
  if (remainingMetres < 0) return 'OVERDUE'
  if (remainingMetres === 0) return 'DUE'
  return remainingMetres <= thresholdMetresValue ? 'DUE_SOON' : 'OK'
}

const RANK: Record<MaintenanceStatus, number> = { OK: 0, DUE_SOON: 1, DUE: 2, OVERDUE: 3 }
const rank = (s: MaintenanceStatus | null): number => (s === null ? -1 : RANK[s])

function worst(a: MaintenanceStatus | null, b: MaintenanceStatus | null): MaintenanceStatus {
  if (a === null && b === null) return 'OK'
  return rank(a) >= rank(b) ? (a ?? 'OK') : (b ?? 'OK')
}

function describe(o: {
  status: MaintenanceStatus
  daysRemaining: number | null
  distanceRemaining: number | null
  unit: DistanceUnit
  triggeringDimension: TriggeringDimension
  confidence: OdometerConfidence
  hasAnyDimension: boolean
  completed: boolean
}): string {
  const unitLabel = o.unit === 'MILES' ? 'miles' : 'km'
  const n = (v: number) => Math.abs(v).toLocaleString('en-GB')

  if (!o.hasAnyDimension) return 'No interval configured'
  if (!o.completed) return 'Not yet recorded'

  if (o.status === 'OVERDUE') {
    if (o.triggeringDimension === 'DISTANCE' && o.distanceRemaining !== null) {
      return `Overdue by ${n(o.distanceRemaining)} ${unitLabel}`
    }
    if (o.daysRemaining !== null) return `Overdue by ${n(o.daysRemaining)} days`
    return 'Overdue'
  }
  if (o.status === 'DUE') return 'Due now'

  // Distance estimates from a stale reading are guesses; say so rather than implying
  // precision we do not have (ARCHITECTURE.md §6).
  if (o.triggeringDimension === 'DISTANCE' && o.distanceRemaining !== null) {
    const base = `Due in about ${n(o.distanceRemaining)} ${unitLabel}`
    return o.confidence === 'STALE' ? `${base} (mileage is out of date)` : base
  }
  if (o.daysRemaining !== null) {
    if (o.status === 'DUE_SOON') return `Due in ${n(o.daysRemaining)} days`
    return `Due ${o.daysRemaining > 60 ? `in ${Math.round(o.daysRemaining / 30)} months` : `in ${n(o.daysRemaining)} days`}`
  }
  if (o.distanceRemaining !== null) return `Due in ${n(o.distanceRemaining)} ${unitLabel}`
  return 'Scheduled'
}

/**
 * Next state after a completion. Returns the fields to persist; the caller writes them
 * inside the same transaction as the completion record.
 */
export function applyCompletion(
  rule: MaintenanceRuleInput,
  completion: {
    completedOn: CalendarDate
    odometer: number | null
    odometerUnit: DistanceUnit | null
  },
): MaintenanceRuleInput {
  return {
    ...rule,
    lastCompletedOn: completion.completedOn,
    lastCompletedOdometer: completion.odometer ?? rule.lastCompletedOdometer,
    lastCompletedUnit: completion.odometerUnit ?? rule.lastCompletedUnit,
  }
}

export { calendarDate }
