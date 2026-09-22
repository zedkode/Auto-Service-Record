import { describe, expect, it } from 'vitest'
import {
  computeFuelTrend,
  MIN_MONTHS_FOR_DIRECTION,
  STABLE_BAND_PERCENT,
  type FillDates,
} from './fuel.trend.engine.js'
import type { EconomyInterval } from './fuel.engine.js'

/**
 * An interval that closes in `period` having covered `km` on `litres`. Only the fields the
 * trend engine reads are meaningful; the rest carry values a real interval would have.
 */
let seq = 0
function interval(
  period: string,
  km: number,
  quantity: number,
  over: Partial<EconomyInterval> = {},
): EconomyInterval {
  const id = `f${++seq}`
  return {
    fromFillId: `${id}-from`,
    toFillId: id,
    fromOdometer: 0,
    toOdometer: km,
    distanceMetres: km * 1000,
    quantity,
    electric: false,
    fillCount: 1,
    litresPer100Km: (quantity / km) * 100,
    kmPerLitre: km / quantity,
    milesPerImperialGallon: null,
    kwhPer100Km: null,
    milesPerKwh: null,
    ...over,
  }
}

/** Dates for a set of intervals: each closes on the 15th of the month it names. */
function datesFor(intervals: EconomyInterval[], periods: string[]): FillDates {
  const map = new Map<string, string>()
  intervals.forEach((i, index) => map.set(i.toFillId, `${periods[index]}-15`))
  return map
}

/** `count` months ending 2026-06, each 1000 km on `litres`. */
function months(count: number, litres: number | ((index: number) => number)) {
  const periods: string[] = []
  for (let i = 0; i < count; i++) {
    const month = 6 - (count - 1 - i)
    periods.push(`2026-${String(month).padStart(2, '0')}`)
  }
  const intervals = periods.map((p, i) =>
    interval(p, 1000, typeof litres === 'function' ? litres(i) : litres),
  )
  return { intervals, dates: datesFor(intervals, periods) }
}

describe('the rule: a trend is not claimed without enough history', () => {
  it('reports nothing from no intervals', () => {
    const r = computeFuelTrend([], new Map())
    expect(r.unavailableReason).toBe('NO_INTERVALS')
    expect(r.direction).toBeNull()
    expect(r.points).toEqual([])
  })

  it('refuses a direction below six measured months', () => {
    const { intervals, dates } = months(MIN_MONTHS_FOR_DIRECTION - 1, 60)
    const r = computeFuelTrend(intervals, dates)
    expect(r.unavailableReason).toBe('NOT_ENOUGH_MONTHS')
    expect(r.direction).toBeNull()
    expect(r.changePercent).toBeNull()
    // The monthly figures are still returned: a chart with five points is useful even
    // when a verdict on it would not be.
    expect(r.points).toHaveLength(MIN_MONTHS_FOR_DIRECTION - 1)
  })

  it('gives a direction at exactly six', () => {
    const { intervals, dates } = months(MIN_MONTHS_FOR_DIRECTION, 60)
    const r = computeFuelTrend(intervals, dates)
    expect(r.unavailableReason).toBeNull()
    expect(r.direction).toBe('STABLE')
  })

  it('counts months, not fills: twelve fills in one month are still one month', () => {
    const intervals = Array.from({ length: 12 }, () => interval('2026-06', 500, 30))
    const dates = datesFor(intervals, Array(12).fill('2026-06'))
    const r = computeFuelTrend(intervals, dates)
    expect(r.points).toHaveLength(1)
    expect(r.points[0]!.intervalCount).toBe(12)
    expect(r.direction).toBeNull()
    expect(r.unavailableReason).toBe('NOT_ENOUGH_MONTHS')
  })
})

describe('the rule: direction follows consumption, and higher is worse', () => {
  it('calls rising consumption WORSENING', () => {
    // 6 L/100km for three months, then 8 — a third worse.
    const { intervals, dates } = months(6, (i) => (i < 3 ? 60 : 80))
    const r = computeFuelTrend(intervals, dates)
    expect(r.direction).toBe('WORSENING')
    expect(r.changePercent).toBeCloseTo(33.33, 1)
  })

  it('calls falling consumption IMPROVING', () => {
    const { intervals, dates } = months(6, (i) => (i < 3 ? 80 : 60))
    const r = computeFuelTrend(intervals, dates)
    expect(r.direction).toBe('IMPROVING')
    expect(r.changePercent).toBeCloseTo(-25, 1)
  })

  it('treats a change inside the band as STABLE', () => {
    // 4% worse: real tanks vary by more than this between fills.
    const { intervals, dates } = months(6, (i) => (i < 3 ? 60 : 62.4))
    const r = computeFuelTrend(intervals, dates)
    expect(r.changePercent).toBeCloseTo(4, 1)
    expect(r.direction).toBe('STABLE')
    expect(Math.abs(r.changePercent!)).toBeLessThanOrEqual(STABLE_BAND_PERCENT)
  })

  it('does not flip the verdict on an efficiency measure that runs the other way', () => {
    // mpg RISES as a car improves while L/100km FALLS. Using mpg here would report an
    // improving car as worsening, which is the one mistake in this engine a user would
    // act on — by booking a service the car does not need.
    const { intervals, dates } = months(6, (i) => (i < 3 ? 80 : 60))
    const r = computeFuelTrend(intervals, dates)
    const first = r.points[0]!
    const last = r.points.at(-1)!
    expect(last.milesPerImperialGallon!).toBeGreaterThan(first.milesPerImperialGallon!)
    expect(r.direction).toBe('IMPROVING')
  })
})

describe('the rule: months are weighted by distance, not counted equally', () => {
  it('does not let a single short month swing the verdict', () => {
    // Two heavy months at 6 L/100km and one 20 km trip at 20 L/100km. A mean of the three
    // monthly figures would read 10.7 and scream WORSENING; the car did not change.
    const periods = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
    const intervals = [
      interval('2026-01', 1000, 60),
      interval('2026-02', 1000, 60),
      interval('2026-03', 1000, 60),
      interval('2026-04', 1000, 60),
      interval('2026-05', 1000, 60),
      interval('2026-06', 20, 4),
    ]
    const r = computeFuelTrend(intervals, datesFor(intervals, periods))
    expect(r.direction).toBe('STABLE')
    expect(Math.abs(r.changePercent!)).toBeLessThan(STABLE_BAND_PERCENT)
  })
})

describe('the rule: an interval belongs to the month it closed in', () => {
  it('attributes a tank bought in March and burned into April to April', () => {
    const i = interval('2026-04', 1000, 60)
    const r = computeFuelTrend([i], new Map([[i.toFillId, '2026-04-02']]))
    expect(r.points[0]!.period).toBe('2026-04')
  })

  it('ignores an interval whose closing fill has no date', () => {
    const { intervals, dates } = months(6, 60)
    const orphan = interval('2026-07', 1000, 200)
    const r = computeFuelTrend([...intervals, orphan], dates)
    expect(r.points.map((p) => p.period)).not.toContain('2026-07')
    // And the orphan's absurd consumption does not reach the verdict.
    expect(r.direction).toBe('STABLE')
  })
})

describe('the rule: litres and kWh are never averaged together', () => {
  it('refuses a trend for a vehicle with both', () => {
    const petrol = interval('2026-01', 1000, 60)
    const ev = interval('2026-02', 1000, 150, { electric: true })
    const r = computeFuelTrend([petrol, ev], datesFor([petrol, ev], ['2026-01', '2026-02']))
    expect(r.unavailableReason).toBe('MIXED_ENERGY')
    expect(r.direction).toBeNull()
    expect(r.points).toEqual([])
  })

  it('reports an electric car in kWh/100km and judges it the same way', () => {
    const periods = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
    const intervals = periods.map((p, i) =>
      interval(p, 1000, i < 3 ? 150 : 200, { electric: true }),
    )
    const r = computeFuelTrend(intervals, datesFor(intervals, periods))
    expect(r.electric).toBe(true)
    expect(r.points[0]!.kwhPer100Km).toBe(15)
    expect(r.points[0]!.litresPer100Km).toBeNull()
    expect(r.direction).toBe('WORSENING')
  })
})

describe('the rule: a direction that could be the weather says so', () => {
  it('flags seasonal overlap under a year of history', () => {
    const { intervals, dates } = months(6, 60)
    expect(computeFuelTrend(intervals, dates).cautions).toContain('SEASONAL_OVERLAP')
  })

  it('drops the flag once a full year is covered', () => {
    const periods: string[] = []
    for (let m = 7; m <= 12; m++) periods.push(`2025-${String(m).padStart(2, '0')}`)
    for (let m = 1; m <= 6; m++) periods.push(`2026-${String(m).padStart(2, '0')}`)
    const intervals = periods.map((p) => interval(p, 1000, 60))
    const r = computeFuelTrend(intervals, datesFor(intervals, periods))
    expect(r.cautions).not.toContain('SEASONAL_OVERLAP')
  })

  it('flags a month resting on a single interval', () => {
    const { intervals, dates } = months(6, 60)
    expect(computeFuelTrend(intervals, dates).cautions).toContain('SPARSE_DATA')
  })

  it('names the two windows it compared', () => {
    const { intervals, dates } = months(6, 60)
    const r = computeFuelTrend(intervals, dates)
    expect(r.basis).toEqual({ earlier: ['2026-01', '2026-03'], recent: ['2026-04', '2026-06'] })
  })

  it('compares only the last six months when more exist', () => {
    // Twelve months: terrible for the first six, steady for the last six. The verdict is
    // about the car now, not about a year ago.
    const periods: string[] = []
    for (let m = 7; m <= 12; m++) periods.push(`2025-${String(m).padStart(2, '0')}`)
    for (let m = 1; m <= 6; m++) periods.push(`2026-${String(m).padStart(2, '0')}`)
    const intervals = periods.map((p, i) => interval(p, 1000, i < 6 ? 200 : 60))
    const r = computeFuelTrend(intervals, datesFor(intervals, periods))
    expect(r.basis!.earlier).toEqual(['2026-01', '2026-03'])
    expect(r.direction).toBe('STABLE')
  })
})
