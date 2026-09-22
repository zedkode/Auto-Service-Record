/**
 * OWN-004 — is this still under warranty?
 *
 * "3 years or 60,000 miles, whichever comes first" is one obligation with two clocks, and
 * the mileage clock is the one products forget. A vehicle doing 25,000 miles a year runs
 * out of a 60,000-mile warranty in under three years, and an app that tracks only the
 * expiry date tells its owner they are covered on the day they stop being covered — the
 * single most expensive thing this feature could get wrong.
 *
 * Pure, so every combination of "date known / distance known / neither" can be tested
 * without a database.
 */

export type DistanceUnit = 'MILES' | 'KILOMETERS'

const METRES_PER_MILE = 1609.344
const toMetres = (value: number, unit: DistanceUnit) =>
  unit === 'MILES' ? value * METRES_PER_MILE : value * 1000
const fromMetres = (metres: number, unit: DistanceUnit) =>
  unit === 'MILES' ? metres / METRES_PER_MILE : metres / 1000

export type WarrantyType = 'MANUFACTURER' | 'DEALER' | 'THIRD_PARTY' | 'PART' | 'REPAIR'

/**
 * Warranties on work done are measured from the mileage at which the work happened; a
 * vehicle-level warranty's allowance is an odometer reading in its own right.
 */
const MEASURED_FROM_FITTING: ReadonlySet<WarrantyType> = new Set<WarrantyType>(['PART', 'REPAIR'])

export interface WarrantyInput {
  warrantyType: WarrantyType
  startsOn: string
  expiresOn: string | null
  /**
   * The mileage allowance. Its meaning depends on `startOdometer`: with one, it is
   * distance driven SINCE that reading (a part or a repair); without one, it is an
   * absolute odometer reading (a manufacturer's "60,000 miles").
   */
  distanceLimit: number | null
  distanceLimitUnit: DistanceUnit | null
  startOdometer: number | null
  startOdometerUnit: DistanceUnit | null
}

export interface WarrantyReading {
  currentOdometer: number | null
  currentOdometerUnit: DistanceUnit | null
}

export type WarrantyState =
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  /** Starts in the future: recorded, but not yet protecting anything. */
  | 'NOT_STARTED'
  /** Neither a date nor a usable mileage limit — nothing to measure against. */
  | 'UNKNOWN'

export type LimitKind = 'DATE' | 'DISTANCE'

export type WarrantyCaution =
  /** A mileage limit exists but no current reading, so only the date could be checked. */
  | 'NO_ODOMETER'
  /** A mileage limit exists with no starting reading on a part or repair warranty. */
  | 'NO_START_ODOMETER'

export interface WarrantyStatus {
  state: WarrantyState
  /** Which clock ran out first, or which will. Null when nothing can be measured. */
  governedBy: LimitKind | null
  daysRemaining: number | null
  /** In `distanceLimitUnit`, so it reads back in the unit the user typed. */
  distanceRemaining: number | null
  cautions: WarrantyCaution[]
}

/** Warn this far ahead — the same window the reminder engine uses for expiries. */
export const EXPIRING_SOON_DAYS = 90

/** And this far, on the mileage clock. Roughly a month of ordinary driving. */
export const EXPIRING_SOON_DISTANCE_MILES = 1000

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

export function warrantyStatus(
  warranty: WarrantyInput,
  reading: WarrantyReading,
  today: string,
): WarrantyStatus {
  const cautions: WarrantyCaution[] = []

  if (warranty.startsOn > today) {
    return {
      state: 'NOT_STARTED',
      governedBy: null,
      daysRemaining: daysBetween(today, warranty.startsOn),
      distanceRemaining: null,
      cautions,
    }
  }

  // --- the date clock ---
  const daysRemaining = warranty.expiresOn ? daysBetween(today, warranty.expiresOn) : null

  // --- the mileage clock ---
  let distanceRemaining: number | null = null
  if (warranty.distanceLimit !== null && warranty.distanceLimitUnit) {
    if (reading.currentOdometer === null || !reading.currentOdometerUnit) {
      // The limit exists but cannot be evaluated. Reported rather than ignored: telling
      // somebody they are covered because we could not check the mileage is the failure
      // this whole engine exists to avoid.
      cautions.push('NO_ODOMETER')
    } else {
      const currentMetres = toMetres(reading.currentOdometer, reading.currentOdometerUnit)
      const limitMetres = toMetres(warranty.distanceLimit, warranty.distanceLimitUnit)

      let remainingMetres: number
      if (warranty.startOdometer !== null && warranty.startOdometerUnit) {
        // Distance driven since the part was fitted, against the allowance.
        const startMetres = toMetres(warranty.startOdometer, warranty.startOdometerUnit)
        remainingMetres = limitMetres - (currentMetres - startMetres)
      } else {
        /**
         * A part or repair warranty with no starting reading. Its allowance means
         * "distance since fitting", and with nothing to measure from the only honest
         * fallback is to read it as an absolute odometer limit — which will usually say
         * the warranty expired long ago. Flagged rather than hidden, because the fix is
         * for someone to supply the reading.
         */
        if (MEASURED_FROM_FITTING.has(warranty.warrantyType)) cautions.push('NO_START_ODOMETER')
        // An absolute odometer limit: the reading itself must stay under it.
        remainingMetres = limitMetres - currentMetres
      }
      distanceRemaining = Math.round(fromMetres(remainingMetres, warranty.distanceLimitUnit))
    }
  }

  if (daysRemaining === null && distanceRemaining === null) {
    return {
      state: 'UNKNOWN',
      governedBy: null,
      daysRemaining: null,
      distanceRemaining: null,
      cautions,
    }
  }

  // --- whichever ran out first ---
  const dateExpired = daysRemaining !== null && daysRemaining < 0
  const distanceExpired = distanceRemaining !== null && distanceRemaining < 0

  if (dateExpired || distanceExpired) {
    return {
      state: 'EXPIRED',
      // When both have run out, name the mileage: it is the one the owner did not expect,
      // and the one they can still verify against the odometer in front of them.
      governedBy: distanceExpired ? 'DISTANCE' : 'DATE',
      daysRemaining,
      distanceRemaining,
      cautions,
    }
  }

  const dateSoon = daysRemaining !== null && daysRemaining <= EXPIRING_SOON_DAYS
  const distanceSoonMetres = toMetres(EXPIRING_SOON_DISTANCE_MILES, 'MILES')
  const distanceSoon =
    distanceRemaining !== null &&
    warranty.distanceLimitUnit !== null &&
    toMetres(distanceRemaining, warranty.distanceLimitUnit) <= distanceSoonMetres

  if (dateSoon || distanceSoon) {
    return {
      state: 'EXPIRING_SOON',
      governedBy: distanceSoon ? 'DISTANCE' : 'DATE',
      daysRemaining,
      distanceRemaining,
      cautions,
    }
  }

  return {
    state: 'ACTIVE',
    // Which clock will run out first, for the "covered until…" line.
    governedBy: whichEndsFirst(daysRemaining, distanceRemaining, warranty.distanceLimitUnit),
    daysRemaining,
    distanceRemaining,
    cautions,
  }
}

/**
 * Compares the two clocks by converting the mileage one into days at an assumed rate.
 *
 * The rate is an ASSUMPTION and is used only to order two futures for a label — never to
 * decide that a warranty has ended. That decision always comes from a real reading.
 */
const ASSUMED_MILES_PER_DAY = 30

function whichEndsFirst(
  daysRemaining: number | null,
  distanceRemaining: number | null,
  unit: DistanceUnit | null,
): LimitKind | null {
  if (daysRemaining === null) return distanceRemaining === null ? null : 'DISTANCE'
  if (distanceRemaining === null || !unit) return 'DATE'
  const milesRemaining = fromMetres(toMetres(distanceRemaining, unit), 'MILES')
  return milesRemaining / ASSUMED_MILES_PER_DAY < daysRemaining ? 'DISTANCE' : 'DATE'
}
