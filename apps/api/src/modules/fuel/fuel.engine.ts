import { kilometersToMetres, milesToMetres, type Metres } from '@autoservices/types'

/**
 * OWN-006 — fuel economy, computed tank to tank (DECISIONS.md D-002).
 *
 * A pure function over plain inputs, so the rule that makes every figure trustworthy can
 * be tested exhaustively without a database.
 *
 * The rule: consumption is measurable only between two fills that BOTH filled the tank.
 * Between them the tank starts full and ends full, so everything bought in between was
 * burned over the distance covered. A partial fill leaves the tank at an unknown level,
 * which is why it can never be an endpoint — it is accumulated into the interval that
 * ends at the next full fill.
 *
 * Getting this wrong does not produce a slightly wrong number; it produces wild figures
 * that make a user distrust every number in the product.
 */

export type QuantityUnit = 'LITRES' | 'US_GALLONS' | 'IMP_GALLONS' | 'KWH'
export type DistanceUnit = 'MILES' | 'KILOMETERS'

export interface FuelFill {
  id: string
  filledOn: string
  odometer: number
  odometerUnit: DistanceUnit
  quantity: number
  quantityUnit: QuantityUnit
  /** Filled to the top. Only these can bound an interval. */
  isFullTank: boolean
  /** A fill was missed since the last one, so the chain of evidence is broken. */
  missedFill: boolean
}

const LITRES_PER_US_GALLON = 3.785411784
const LITRES_PER_IMP_GALLON = 4.54609

/** Litres for anything liquid; kWh is a different physical quantity and stays itself. */
function toCanonicalQuantity(quantity: number, unit: QuantityUnit): number {
  switch (unit) {
    case 'LITRES':
      return quantity
    case 'US_GALLONS':
      return quantity * LITRES_PER_US_GALLON
    case 'IMP_GALLONS':
      return quantity * LITRES_PER_IMP_GALLON
    case 'KWH':
      return quantity
  }
}

const isElectric = (unit: QuantityUnit) => unit === 'KWH'

function toMetres(value: number, unit: DistanceUnit): Metres {
  return unit === 'MILES' ? milesToMetres(value as never) : kilometersToMetres(value as never)
}

export type IntervalSkipReason = 'MISSED_FILL' | 'NO_DISTANCE' | 'MIXED_ENERGY' | 'NO_QUANTITY'

export interface EconomyInterval {
  fromFillId: string
  toFillId: string
  fromOdometer: number
  toOdometer: number
  distanceMetres: number
  /** Litres, or kWh when the interval is electric. */
  quantity: number
  electric: boolean
  /** How many fills contributed, including partials rolled into this interval. */
  fillCount: number
  litresPer100Km: number | null
  kmPerLitre: number | null
  milesPerImperialGallon: number | null
  kwhPer100Km: number | null
  milesPerKwh: number | null
}

export interface SkippedInterval {
  fromFillId: string
  toFillId: string
  reason: IntervalSkipReason
}

export interface EconomyResult {
  intervals: EconomyInterval[]
  skipped: SkippedInterval[]
  /** Null until two full fills exist — the UI says so rather than showing a wrong number. */
  average: {
    litresPer100Km: number | null
    kmPerLitre: number | null
    milesPerImperialGallon: number | null
    kwhPer100Km: number | null
    milesPerKwh: number | null
    distanceMetres: number
    quantity: number
    electric: boolean
  } | null
  /** Why there is no average yet, when there is not. */
  unavailableReason: 'NO_FILLS' | 'ONE_FULL_FILL' | 'NO_USABLE_INTERVAL' | null
}

const round = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const METRES_PER_MILE = 1609.344
const METRES_PER_IMP_GALLON_MILES = LITRES_PER_IMP_GALLON

function economyFor(distanceMetres: number, quantity: number, electric: boolean) {
  const km = distanceMetres / 1000
  const milesDriven = distanceMetres / METRES_PER_MILE

  if (electric) {
    return {
      litresPer100Km: null,
      kmPerLitre: null,
      milesPerImperialGallon: null,
      kwhPer100Km: round((quantity / km) * 100, 2),
      milesPerKwh: round(milesDriven / quantity, 2),
    }
  }
  return {
    litresPer100Km: round((quantity / km) * 100, 2),
    kmPerLitre: round(km / quantity, 2),
    milesPerImperialGallon: round(milesDriven / (quantity / METRES_PER_IMP_GALLON_MILES), 2),
    kwhPer100Km: null,
    milesPerKwh: null,
  }
}

/**
 * Computes every measurable interval, and the average across them.
 *
 * Fills are ordered by ODOMETER, not by date: a fill logged days later is still a fill
 * that happened at that mileage, and ordering by date would invent a negative distance.
 */
export function computeEconomy(fills: readonly FuelFill[]): EconomyResult {
  const ordered = [...fills].sort((a, b) => a.odometer - b.odometer)

  if (ordered.length === 0) {
    return { intervals: [], skipped: [], average: null, unavailableReason: 'NO_FILLS' }
  }

  const fullIndexes = ordered.map((f, i) => (f.isFullTank ? i : -1)).filter((i) => i !== -1)
  if (fullIndexes.length < 2) {
    return {
      intervals: [],
      skipped: [],
      average: null,
      unavailableReason: fullIndexes.length === 1 ? 'ONE_FULL_FILL' : 'NO_USABLE_INTERVAL',
    }
  }

  const intervals: EconomyInterval[] = []
  const skipped: SkippedInterval[] = []

  for (let n = 0; n < fullIndexes.length - 1; n++) {
    const startIndex = fullIndexes[n]!
    const endIndex = fullIndexes[n + 1]!
    const from = ordered[startIndex]!
    const to = ordered[endIndex]!

    // Everything bought AFTER the opening full fill, up to and including the closing one.
    // The opening fill's own fuel was burned before this interval began.
    const consumed = ordered.slice(startIndex + 1, endIndex + 1)

    const note = (reason: IntervalSkipReason) =>
      skipped.push({ fromFillId: from.id, toFillId: to.id, reason })

    // A missed fill anywhere in the window means distance was covered on fuel nobody
    // recorded. The arithmetic would still produce a number; it would just be a lie.
    if (consumed.some((f) => f.missedFill) || to.missedFill) {
      note('MISSED_FILL')
      continue
    }

    const electricCount = consumed.filter((f) => isElectric(f.quantityUnit)).length
    if (electricCount > 0 && electricCount !== consumed.length) {
      // A plug-in hybrid charged and fuelled in the same window: litres and kWh cannot be
      // added, and picking one would understate the other.
      note('MIXED_ENERGY')
      continue
    }

    const distanceMetres =
      (toMetres(to.odometer, to.odometerUnit) as number) -
      (toMetres(from.odometer, from.odometerUnit) as number)
    if (distanceMetres <= 0) {
      note('NO_DISTANCE')
      continue
    }

    const quantity = consumed.reduce(
      (sum, f) => sum + toCanonicalQuantity(f.quantity, f.quantityUnit),
      0,
    )
    if (quantity <= 0) {
      note('NO_QUANTITY')
      continue
    }

    const electric = electricCount === consumed.length
    intervals.push({
      fromFillId: from.id,
      toFillId: to.id,
      fromOdometer: from.odometer,
      toOdometer: to.odometer,
      distanceMetres: round(distanceMetres, 1),
      quantity: round(quantity, 3),
      electric,
      fillCount: consumed.length,
      ...economyFor(distanceMetres, quantity, electric),
    })
  }

  if (intervals.length === 0) {
    return { intervals: [], skipped, average: null, unavailableReason: 'NO_USABLE_INTERVAL' }
  }

  // Averaged over total distance and total quantity, NOT as the mean of per-interval
  // figures: a short interval would otherwise weigh as much as a long one.
  const liquid = intervals.filter((i) => !i.electric)
  const electricOnes = intervals.filter((i) => i.electric)
  const pool = liquid.length >= electricOnes.length ? liquid : electricOnes
  const electric = pool === electricOnes

  const distanceMetres = pool.reduce((sum, i) => sum + i.distanceMetres, 0)
  const quantity = pool.reduce((sum, i) => sum + i.quantity, 0)

  return {
    intervals,
    skipped,
    average: {
      ...economyFor(distanceMetres, quantity, electric),
      distanceMetres: round(distanceMetres, 1),
      quantity: round(quantity, 3),
      electric,
    },
    unavailableReason: null,
  }
}
