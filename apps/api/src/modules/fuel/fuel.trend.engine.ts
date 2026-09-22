/**
 * RPT-003 — fuel economy over time.
 *
 * `computeEconomy` answers "what does this car return?". This answers the more useful
 * question: "is it getting worse?" — the one that catches a dragging brake, a failing
 * sensor or a slipping clutch months before a warning light does.
 *
 * Pure, like the rest of the domain: the rules about when a trend must NOT be claimed are
 * the valuable part, and they are only cheap to test exhaustively while there is no
 * database in the way.
 */
import type { EconomyInterval } from './fuel.engine.js'

/** Fill dates, keyed by id, so an interval can be placed in the month it ended. */
export type FillDates = ReadonlyMap<string, string>

export interface TrendPoint {
  /** `YYYY-MM`. */
  period: string
  distanceMetres: number
  quantity: number
  electric: boolean
  intervalCount: number
  litresPer100Km: number | null
  kmPerLitre: number | null
  milesPerImperialGallon: number | null
  kwhPer100Km: number | null
  milesPerKwh: number | null
}

export type TrendDirection = 'IMPROVING' | 'WORSENING' | 'STABLE'

export type TrendUnavailable = 'NO_INTERVALS' | 'NOT_ENOUGH_MONTHS' | 'MIXED_ENERGY'

/**
 * A caveat attached to a direction that is real but easy to misread.
 *
 * `SEASONAL_OVERLAP` is the one that matters. Winter economy is materially worse than
 * summer economy in the same healthy car — cold starts, richer running, winter fuel
 * blends, heating load. Comparing November against August therefore measures the weather.
 * Under a year of history there is no like-for-like month to compare, so the direction is
 * still reported, and still labelled.
 */
export type TrendCaution = 'SEASONAL_OVERLAP' | 'SPARSE_DATA'

export interface FuelTrend {
  points: TrendPoint[]
  direction: TrendDirection | null
  /** Percent change in consumption; positive means using MORE fuel per distance. */
  changePercent: number | null
  /** The two windows compared, as `YYYY-MM` bounds, when a direction was produced. */
  basis: { earlier: string[]; recent: string[] } | null
  cautions: TrendCaution[]
  unavailableReason: TrendUnavailable | null
  electric: boolean
}

/**
 * Below this, a direction is noise. Three months per window, two windows: six months of
 * data before this product tells somebody their car is getting worse.
 */
export const WINDOW_MONTHS = 3
export const MIN_MONTHS_FOR_DIRECTION = WINDOW_MONTHS * 2

/** Under this, call it stable. Fuel economy varies by more than this between tanks. */
export const STABLE_BAND_PERCENT = 5

/** A year of history is what it takes to compare a month with its own season. */
const MONTHS_FOR_SEASONAL_COVER = 12

const round2 = (n: number) => Math.round(n * 100) / 100

function economyFor(distanceMetres: number, quantity: number, electric: boolean) {
  const km = distanceMetres / 1000
  const miles = distanceMetres / 1609.344
  if (electric) {
    return {
      litresPer100Km: null,
      kmPerLitre: null,
      milesPerImperialGallon: null,
      kwhPer100Km: round2((quantity / km) * 100),
      milesPerKwh: round2(miles / quantity),
    }
  }
  return {
    litresPer100Km: round2((quantity / km) * 100),
    kmPerLitre: round2(km / quantity),
    milesPerImperialGallon: round2(miles / (quantity / 4.54609)),
    kwhPer100Km: null,
    milesPerKwh: null,
  }
}

/**
 * Consumption per 100 km, whichever energy the car uses. Higher is always worse, which is
 * what makes a single comparison possible; miles-per-gallon runs the other way and would
 * invert the verdict if used here by mistake.
 */
const consumptionOf = (p: TrendPoint) => (p.electric ? p.kwhPer100Km : p.litresPer100Km)

/** Months between two `YYYY-MM` keys, inclusive of both ends. */
function monthSpan(first: string, last: string): number {
  const [fy, fm] = first.split('-').map(Number) as [number, number]
  const [ly, lm] = last.split('-').map(Number) as [number, number]
  return (ly - fy) * 12 + (lm - fm) + 1
}

/**
 * Groups measured intervals into calendar months and says which way they are going.
 *
 * An interval is attributed to the month of its CLOSING fill: that is when the fuel had
 * demonstrably been used. Attributing it to the opening fill would credit consumption to a
 * month before most of the driving happened.
 */
export function computeFuelTrend(
  intervals: readonly EconomyInterval[],
  fillDates: FillDates,
): FuelTrend {
  if (intervals.length === 0) {
    return {
      points: [],
      direction: null,
      changePercent: null,
      basis: null,
      cautions: [],
      unavailableReason: 'NO_INTERVALS',
      electric: false,
    }
  }

  const electricCount = intervals.filter((i) => i.electric).length
  if (electricCount > 0 && electricCount !== intervals.length) {
    // A converted vehicle, or bad data. Litres and kWh do not average into one curve, and
    // silently picking one would report a cliff where there was only a change of fuel.
    return {
      points: [],
      direction: null,
      changePercent: null,
      basis: null,
      cautions: [],
      unavailableReason: 'MIXED_ENERGY',
      electric: false,
    }
  }
  const electric = electricCount > 0

  const buckets = new Map<string, { distanceMetres: number; quantity: number; count: number }>()
  for (const interval of intervals) {
    const closedOn = fillDates.get(interval.toFillId)
    // An interval whose closing fill has no date cannot be placed on a timeline. It still
    // counts towards the lifetime average; it just cannot contribute to a trend.
    if (!closedOn) continue
    const period = closedOn.slice(0, 7)
    const bucket = buckets.get(period) ?? { distanceMetres: 0, quantity: 0, count: 0 }
    bucket.distanceMetres += interval.distanceMetres
    bucket.quantity += interval.quantity
    bucket.count += 1
    buckets.set(period, bucket)
  }

  const points: TrendPoint[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, b]) => ({
      period,
      distanceMetres: Math.round(b.distanceMetres),
      quantity: round2(b.quantity),
      electric,
      intervalCount: b.count,
      ...economyFor(b.distanceMetres, b.quantity, electric),
    }))

  const measured = points.filter((p) => consumptionOf(p) !== null)
  if (measured.length < MIN_MONTHS_FOR_DIRECTION) {
    return {
      points,
      direction: null,
      changePercent: null,
      basis: null,
      cautions: [],
      unavailableReason: points.length === 0 ? 'NO_INTERVALS' : 'NOT_ENOUGH_MONTHS',
      electric,
    }
  }

  const recent = measured.slice(-WINDOW_MONTHS)
  const earlier = measured.slice(-MIN_MONTHS_FOR_DIRECTION, -WINDOW_MONTHS)

  /**
   * Distance-weighted, not a mean of the monthly figures: a month with one short trip
   * should not weigh as heavily as a month of commuting. Weighting by distance is the same
   * thing as recomputing consumption over the whole window, which is what a driver means
   * by "the last three months".
   */
  const windowConsumption = (window: TrendPoint[]) => {
    const distance = window.reduce((sum, p) => sum + p.distanceMetres, 0)
    const quantity = window.reduce((sum, p) => sum + p.quantity, 0)
    return distance > 0 ? (quantity / (distance / 1000)) * 100 : null
  }

  const earlierConsumption = windowConsumption(earlier)
  const recentConsumption = windowConsumption(recent)
  if (earlierConsumption === null || recentConsumption === null || earlierConsumption === 0) {
    return {
      points,
      direction: null,
      changePercent: null,
      basis: null,
      cautions: [],
      unavailableReason: 'NOT_ENOUGH_MONTHS',
      electric,
    }
  }

  const changePercent = round2(
    ((recentConsumption - earlierConsumption) / earlierConsumption) * 100,
  )

  let direction: TrendDirection = 'STABLE'
  if (changePercent > STABLE_BAND_PERCENT) direction = 'WORSENING'
  else if (changePercent < -STABLE_BAND_PERCENT) direction = 'IMPROVING'

  const cautions: TrendCaution[] = []
  if (monthSpan(measured[0]!.period, measured.at(-1)!.period) < MONTHS_FOR_SEASONAL_COVER) {
    cautions.push('SEASONAL_OVERLAP')
  }
  if (measured.some((p) => p.intervalCount < 2)) cautions.push('SPARSE_DATA')

  return {
    points,
    direction,
    changePercent,
    basis: {
      earlier: [earlier[0]!.period, earlier.at(-1)!.period],
      recent: [recent[0]!.period, recent.at(-1)!.period],
    },
    cautions,
    unavailableReason: null,
    electric,
  }
}
