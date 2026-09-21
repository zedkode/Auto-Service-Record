/**
 * MNT-002 — exhaustive fixture table for the maintenance engine.
 *
 * TESTING.md §3: every combination of {time-only, distance-only, combined} ×
 * {fresh, stale, unknown odometer} × {not due, due soon, due, overdue}. These are the
 * calculations users will notice being wrong, so they are tested exhaustively.
 */
import { describe, expect, it } from 'vitest'
import { calendarDate, type CalendarDate } from '@autoservices/types'
import {
  evaluateRule,
  applyCompletion,
  ODOMETER_STALE_DAYS,
  type MaintenanceRuleInput,
  type OdometerReading,
  type MaintenanceStatus,
} from './maintenance.engine.js'

const TODAY = calendarDate('2026-09-20')

const daysBefore = (n: number): CalendarDate => {
  const d = new Date(Date.UTC(2026, 8, 20))
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10) as CalendarDate
}

const base: MaintenanceRuleInput = {
  intervalType: 'COMBINED',
  intervalDistance: 10_000,
  intervalDistanceUnit: 'MILES',
  intervalMonths: 12,
  thresholdDistance: null,
  thresholdDays: null,
  lastCompletedOn: null,
  lastCompletedOdometer: null,
  lastCompletedUnit: null,
}

const rule = (o: Partial<MaintenanceRuleInput>): MaintenanceRuleInput => ({ ...base, ...o })
const odo = (
  value: number,
  daysAgo = 1,
  unit: 'MILES' | 'KILOMETERS' = 'MILES',
): OdometerReading => ({
  value,
  unit,
  recordedOn: daysBefore(daysAgo),
})

describe('time-based rules', () => {
  const timeOnly = (lastCompletedOn: CalendarDate, months = 12) =>
    rule({
      intervalType: 'TIME_BASED',
      intervalMonths: months,
      intervalDistance: null,
      lastCompletedOn,
    })

  const cases: Array<[string, number, MaintenanceStatus]> = [
    ['completed today, 12mo interval', 0, 'OK'],
    ['6 months in', 182, 'OK'],
    ['11 months in (within 30-day window)', 340, 'DUE_SOON'],
    // Exactly 12 months on is the due date itself, not past it.
    ['exactly at the interval', 365, 'DUE'],
    ['one day past', 366, 'OVERDUE'],
    ['2 months past', 425, 'OVERDUE'],
  ]

  it.each(cases)('%s -> %s', (_label, daysAgo, expected) => {
    const state = evaluateRule(timeOnly(daysBefore(daysAgo)), null, TODAY)
    expect(state.status).toBe(expected)
  })

  it('reports DUE exactly on the due date', () => {
    // Completed exactly 12 months ago to the day.
    const state = evaluateRule(timeOnly(calendarDate('2025-09-20')), null, TODAY)
    expect(state.nextDueOn).toBe('2026-09-20')
    expect(state.status).toBe('DUE')
    expect(state.daysRemaining).toBe(0)
    expect(state.summary).toBe('Due now')
  })

  it('handles month-end arithmetic without rolling over', () => {
    // 31 Aug + 6 months = 28 Feb, not 3 March.
    const state = evaluateRule(
      rule({
        intervalType: 'TIME_BASED',
        intervalMonths: 6,
        intervalDistance: null,
        lastCompletedOn: calendarDate('2025-08-31'),
      }),
      null,
      TODAY,
    )
    expect(state.nextDueOn).toBe('2026-02-28')
  })

  it('handles a leap-year target', () => {
    const state = evaluateRule(
      rule({
        intervalType: 'TIME_BASED',
        intervalMonths: 12,
        intervalDistance: null,
        lastCompletedOn: calendarDate('2027-02-29'),
      }),
      null,
      TODAY,
    )
    expect(state.nextDueOn).toBe('2028-02-29')
  })

  it('ignores the odometer entirely', () => {
    const state = evaluateRule(timeOnly(daysBefore(10)), odo(999_999), TODAY)
    expect(state.status).toBe('OK')
    expect(state.nextDueOdometer).toBeNull()
  })
})

describe('distance-based rules', () => {
  const distOnly = (lastOdo: number, interval = 10_000) =>
    rule({
      intervalType: 'DISTANCE_BASED',
      intervalDistance: interval,
      intervalMonths: null,
      lastCompletedOdometer: lastOdo,
      lastCompletedUnit: 'MILES',
      lastCompletedOn: daysBefore(30),
    })

  const cases: Array<[string, number, number, MaintenanceStatus]> = [
    ['just serviced', 150_000, 150_100, 'OK'],
    ['half way', 150_000, 155_000, 'OK'],
    ['within the 500-mile window', 150_000, 159_600, 'DUE_SOON'],
    ['exactly at the due mileage', 150_000, 160_000, 'DUE'],
    ['past the due mileage', 150_000, 160_800, 'OVERDUE'],
  ]

  it.each(cases)('%s -> %s', (_l, last, current, expected) => {
    expect(evaluateRule(distOnly(last), odo(current), TODAY).status).toBe(expected)
  })

  it('computes the next due odometer', () => {
    const state = evaluateRule(distOnly(150_000), odo(155_000), TODAY)
    expect(state.nextDueOdometer).toBe(160_000)
    expect(state.distanceRemaining).toBe(5_000)
    expect(state.summary).toContain('5,000 miles')
  })

  it('compares a KILOMETERS reading against a MILES interval correctly', () => {
    // 160,000 mi ≈ 257,495 km. A reading of 250,000 km is still short of due.
    const r = rule({
      intervalType: 'DISTANCE_BASED',
      intervalDistance: 10_000,
      intervalDistanceUnit: 'MILES',
      intervalMonths: null,
      lastCompletedOdometer: 150_000,
      lastCompletedUnit: 'MILES',
      lastCompletedOn: daysBefore(30),
    })
    const state = evaluateRule(r, odo(250_000, 1, 'KILOMETERS'), TODAY)
    expect(state.status).toBe('OK')
    // And 260,000 km is past 160,000 mi.
    expect(evaluateRule(r, odo(260_000, 1, 'KILOMETERS'), TODAY).status).toBe('OVERDUE')
  })

  it('cannot compute distance without a reading', () => {
    const state = evaluateRule(distOnly(150_000), null, TODAY)
    expect(state.distanceRemaining).toBeNull()
    expect(state.odometerConfidence).toBe('UNKNOWN')
    expect(state.status).toBe('OK')
  })
})

describe('combined rules — whichever comes first', () => {
  const combined = (lastOn: CalendarDate, lastOdo: number) =>
    rule({
      intervalType: 'COMBINED',
      lastCompletedOn: lastOn,
      lastCompletedOdometer: lastOdo,
      lastCompletedUnit: 'MILES',
    })

  it('date triggers first', () => {
    // 11 months elapsed, but barely any distance covered.
    const state = evaluateRule(combined(daysBefore(340), 150_000), odo(151_000), TODAY)
    expect(state.status).toBe('DUE_SOON')
    expect(state.triggeringDimension).toBe('DATE')
  })

  it('distance triggers first', () => {
    // Only 2 months elapsed, but 9,700 miles covered.
    const state = evaluateRule(combined(daysBefore(60), 150_000), odo(159_700), TODAY)
    expect(state.status).toBe('DUE_SOON')
    expect(state.triggeringDimension).toBe('DISTANCE')
  })

  it('takes the WORSE of the two dimensions', () => {
    // Date is merely DUE_SOON; distance is already OVERDUE.
    const state = evaluateRule(combined(daysBefore(340), 150_000), odo(161_000), TODAY)
    expect(state.status).toBe('OVERDUE')
    expect(state.triggeringDimension).toBe('DISTANCE')
  })

  it('is OK only when BOTH dimensions are OK', () => {
    const state = evaluateRule(combined(daysBefore(30), 150_000), odo(151_000), TODAY)
    expect(state.status).toBe('OK')
    expect(state.triggeringDimension).toBeNull()
  })
})

describe('odometer confidence', () => {
  const r = rule({
    intervalType: 'DISTANCE_BASED',
    intervalMonths: null,
    lastCompletedOdometer: 150_000,
    lastCompletedUnit: 'MILES',
    lastCompletedOn: daysBefore(30),
  })

  it('is FRESH for a recent reading', () => {
    expect(evaluateRule(r, odo(155_000, 5), TODAY).odometerConfidence).toBe('FRESH')
  })

  it(`is STALE beyond ${ODOMETER_STALE_DAYS} days`, () => {
    expect(evaluateRule(r, odo(155_000, ODOMETER_STALE_DAYS + 1), TODAY).odometerConfidence).toBe(
      'STALE',
    )
  })

  it('is UNKNOWN with no reading at all', () => {
    expect(evaluateRule(r, null, TODAY).odometerConfidence).toBe('UNKNOWN')
  })

  it('says so in the summary rather than implying precision', () => {
    const state = evaluateRule(r, odo(159_700, 90), TODAY)
    expect(state.summary).toContain('mileage is out of date')
  })
})

describe('edge cases', () => {
  it('reports "not yet recorded" when nothing has been completed', () => {
    const state = evaluateRule(rule({}), odo(150_000), TODAY)
    expect(state.summary).toBe('Not yet recorded')
    expect(state.status).toBe('OK')
  })

  it('reports "no interval configured" when neither dimension is set', () => {
    const state = evaluateRule(
      rule({ intervalDistance: null, intervalMonths: null, lastCompletedOn: daysBefore(10) }),
      odo(150_000),
      TODAY,
    )
    expect(state.summary).toBe('No interval configured')
  })

  it('honours a custom threshold', () => {
    // A 90-day window makes a rule due-soon that would otherwise be OK.
    const r = rule({
      intervalType: 'TIME_BASED',
      intervalMonths: 12,
      intervalDistance: null,
      lastCompletedOn: daysBefore(290),
      thresholdDays: 90,
    })
    expect(evaluateRule(r, null, TODAY).status).toBe('DUE_SOON')
    expect(evaluateRule({ ...r, thresholdDays: 10 }, null, TODAY).status).toBe('OK')
  })

  it('never returns a status outside the four documented values', () => {
    const allowed = new Set(['OK', 'DUE_SOON', 'DUE', 'OVERDUE'])
    for (const days of [0, 1, 100, 364, 365, 366, 1000]) {
      for (const miles of [0, 5000, 9999, 10_000, 20_000]) {
        const state = evaluateRule(
          rule({
            lastCompletedOn: daysBefore(days),
            lastCompletedOdometer: 100_000,
            lastCompletedUnit: 'MILES',
          }),
          odo(100_000 + miles),
          TODAY,
        )
        expect(allowed.has(state.status)).toBe(true)
      }
    }
  })
})

describe('applyCompletion', () => {
  it('advances both dimensions and resets the state to OK', () => {
    const overdue = rule({
      lastCompletedOn: daysBefore(400),
      lastCompletedOdometer: 150_000,
      lastCompletedUnit: 'MILES',
    })
    expect(evaluateRule(overdue, odo(161_000), TODAY).status).toBe('OVERDUE')

    const advanced = applyCompletion(overdue, {
      completedOn: TODAY,
      odometer: 161_000,
      odometerUnit: 'MILES',
    })
    const after = evaluateRule(advanced, odo(161_000), TODAY)
    expect(after.status).toBe('OK')
    expect(after.nextDueOn).toBe('2027-09-20')
    expect(after.nextDueOdometer).toBe(171_000)
  })

  it('keeps the previous odometer when a completion records none', () => {
    const r = rule({
      lastCompletedOn: daysBefore(400),
      lastCompletedOdometer: 150_000,
      lastCompletedUnit: 'MILES',
    })
    const advanced = applyCompletion(r, { completedOn: TODAY, odometer: null, odometerUnit: null })
    expect(advanced.lastCompletedOdometer).toBe(150_000)
  })
})
