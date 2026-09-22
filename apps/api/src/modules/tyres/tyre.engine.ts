/**
 * OWN-005 — how far a set of tyres has actually run, and whether it is still legal.
 *
 * A set outlives any single time it is fitted: a winter pair goes on in November and comes
 * off in April, year after year. The number an owner wants is the distance across ALL of
 * those periods, which is why the set and the installation are separate things.
 *
 * Pure, so the two rules that matter — summing across installations, and refusing to
 * predict wear — can be tested without a database.
 */

export type DistanceUnit = 'MILES' | 'KILOMETERS'

const METRES_PER_MILE = 1609.344
const toMetres = (value: number, unit: DistanceUnit) =>
  unit === 'MILES' ? value * METRES_PER_MILE : value * 1000
const fromMetres = (metres: number, unit: DistanceUnit) =>
  unit === 'MILES' ? metres / METRES_PER_MILE : metres / 1000

export interface Installation {
  installedOn: string
  installedOdometer: number | null
  removedOn: string | null
  removedOdometer: number | null
  odometerUnit: DistanceUnit
  treadDepthMm: number | null
  treadMeasuredOn: string | null
}

export type DistanceUnavailable =
  /** Fitted, but nobody recorded the mileage at the time. */
  | 'NO_INSTALL_READING'
  /** Still fitted, and the vehicle has no current reading to measure against. */
  | 'NO_CURRENT_READING'
  /** Never fitted. */
  | 'NEVER_FITTED'

export interface SetDistance {
  metres: number | null
  miles: number | null
  kilometres: number | null
  /** How many fitted periods contributed a measurable distance. */
  measuredPeriods: number
  /** Periods that could not be measured, so a total is never quietly short. */
  unmeasuredPeriods: number
  unavailableReason: DistanceUnavailable | null
}

/**
 * The legal minimum across the UK and EU. Written here once, as a named constant, because
 * it is a legal threshold rather than a preference — and because the number below which a
 * car is illegal to drive should never be buried in a comparison.
 */
export const LEGAL_MINIMUM_TREAD_MM = 1.6

/**
 * Where most manufacturers and safety bodies advise replacement. Wet braking degrades
 * sharply below this, well before the legal limit is reached.
 */
export const ADVISORY_TREAD_MM = 3.0

export type TreadState = 'GOOD' | 'MONITOR' | 'REPLACE_SOON' | 'ILLEGAL' | 'UNKNOWN'

export interface TreadStatus {
  state: TreadState
  depthMm: number | null
  measuredOn: string | null
  /** True once the reading is old enough that it should not be relied on. */
  stale: boolean
}

/** A tread reading older than this is history, not a current fact about the car. */
export const TREAD_READING_STALE_DAYS = 180

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Total distance a set has covered, across every period it has been fitted.
 *
 * The open period — the one with no removal — is measured against the vehicle's CURRENT
 * reading, so the figure keeps up with the car rather than freezing when the set went on.
 */
export function distanceOnSet(
  installations: readonly Installation[],
  current: { odometer: number | null; unit: DistanceUnit | null },
): SetDistance {
  if (installations.length === 0) {
    return {
      metres: null,
      miles: null,
      kilometres: null,
      measuredPeriods: 0,
      unmeasuredPeriods: 0,
      unavailableReason: 'NEVER_FITTED',
    }
  }

  let metres = 0
  let measured = 0
  let unmeasured = 0
  let blockedBy: DistanceUnavailable | null = null

  for (const i of installations) {
    if (i.installedOdometer === null) {
      unmeasured += 1
      blockedBy ??= 'NO_INSTALL_READING'
      continue
    }
    const start = toMetres(i.installedOdometer, i.odometerUnit)

    let end: number
    if (i.removedOdometer !== null) {
      end = toMetres(i.removedOdometer, i.odometerUnit)
    } else if (current.odometer !== null && current.unit) {
      // Still on the car: measure to where the car is now.
      end = toMetres(current.odometer, current.unit)
    } else {
      unmeasured += 1
      blockedBy ??= 'NO_CURRENT_READING'
      continue
    }

    // A period that appears to have run backwards contributes nothing rather than
    // subtracting: a corrected odometer must not make a set look newer than it is.
    if (end > start) metres += end - start
    measured += 1
  }

  if (measured === 0) {
    return {
      metres: null,
      miles: null,
      kilometres: null,
      measuredPeriods: 0,
      unmeasuredPeriods: unmeasured,
      unavailableReason: blockedBy ?? 'NEVER_FITTED',
    }
  }

  const round = (n: number) => Math.round(n)
  return {
    metres: round(metres),
    miles: round(fromMetres(metres, 'MILES')),
    kilometres: round(fromMetres(metres, 'KILOMETERS')),
    measuredPeriods: measured,
    // Reported rather than hidden: a total from three of five periods is not the total.
    unmeasuredPeriods: unmeasured,
    unavailableReason: null,
  }
}

/**
 * The tread state from the most recent measurement.
 *
 * There is deliberately no estimate from mileage. Wear depends on the car, the roads, the
 * pressures and the driver far more than on distance, and a predicted depth shown beside a
 * legal limit would be a number people act on that nobody measured.
 */
export function treadStatus(installations: readonly Installation[], today: string): TreadStatus {
  const measurements = installations
    .filter((i) => i.treadDepthMm !== null && i.treadMeasuredOn !== null)
    .sort((a, b) => (a.treadMeasuredOn! < b.treadMeasuredOn! ? 1 : -1))

  const latest = measurements[0]
  if (!latest) {
    return { state: 'UNKNOWN', depthMm: null, measuredOn: null, stale: false }
  }

  const depth = latest.treadDepthMm!
  const measuredOn = latest.treadMeasuredOn!
  const stale = daysBetween(measuredOn, today) > TREAD_READING_STALE_DAYS

  let state: TreadState
  if (depth < LEGAL_MINIMUM_TREAD_MM) state = 'ILLEGAL'
  else if (depth < ADVISORY_TREAD_MM) state = 'REPLACE_SOON'
  else if (depth < ADVISORY_TREAD_MM + 1) state = 'MONITOR'
  else state = 'GOOD'

  return { state, depthMm: depth, measuredOn, stale }
}

/** The period the set is in right now, if any. */
export function currentInstallation(installations: readonly Installation[]): Installation | null {
  return installations.find((i) => i.removedOn === null) ?? null
}
