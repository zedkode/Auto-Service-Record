import { describe, expect, it } from 'vitest'
import {
  EXPIRING_SOON_DAYS,
  warrantyStatus,
  type WarrantyInput,
  type WarrantyReading,
} from './warranty.engine.js'

const TODAY = '2026-09-22'

/** A manufacturer warranty: three years, no mileage cap unless one is given. */
const warranty = (over: Partial<WarrantyInput> = {}): WarrantyInput => ({
  warrantyType: 'MANUFACTURER',
  startsOn: '2024-09-22',
  expiresOn: '2027-09-22',
  distanceLimit: null,
  distanceLimitUnit: null,
  startOdometer: null,
  startOdometerUnit: null,
  ...over,
})

const odometer = (value: number | null, unit: 'MILES' | 'KILOMETERS' = 'MILES'): WarrantyReading => ({
  currentOdometer: value,
  currentOdometerUnit: value === null ? null : unit,
})

describe('the rule: two clocks, and the first one to run out wins', () => {
  it('is ACTIVE when both the date and the mileage have room', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(30_000),
      TODAY,
    )
    expect(s.state).toBe('ACTIVE')
    expect(s.distanceRemaining).toBe(30_000)
  })

  it('EXPIRES on mileage while the date still has a year to run', () => {
    // The case a date-only product gets wrong: 24,000 miles a year against a 60,000 cap.
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(64_000),
      TODAY,
    )
    expect(s.state).toBe('EXPIRED')
    expect(s.governedBy).toBe('DISTANCE')
    expect(s.distanceRemaining).toBe(-4_000)
    // The date clock has NOT run out, and the figure is still reported.
    expect(s.daysRemaining).toBeGreaterThan(0)
  })

  it('EXPIRES on the date while the mileage still has room', () => {
    const s = warrantyStatus(
      warranty({ expiresOn: '2026-01-01', distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(20_000),
      TODAY,
    )
    expect(s.state).toBe('EXPIRED')
    expect(s.governedBy).toBe('DATE')
    expect(s.distanceRemaining).toBe(40_000)
  })

  it('names the mileage when BOTH have run out', () => {
    // It is the one the owner did not expect, and the one they can check themselves.
    const s = warrantyStatus(
      warranty({ expiresOn: '2026-01-01', distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(70_000),
      TODAY,
    )
    expect(s.state).toBe('EXPIRED')
    expect(s.governedBy).toBe('DISTANCE')
  })

  it('warns when the mileage is nearly gone even though years remain', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(59_500),
      TODAY,
    )
    expect(s.state).toBe('EXPIRING_SOON')
    expect(s.governedBy).toBe('DISTANCE')
  })

  it('warns on the date within the 90-day window', () => {
    const soon = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const s = warrantyStatus(warranty({ expiresOn: soon }), odometer(10_000), TODAY)
    expect(s.state).toBe('EXPIRING_SOON')
    expect(s.daysRemaining).toBe(30)
    expect(s.daysRemaining!).toBeLessThanOrEqual(EXPIRING_SOON_DAYS)
  })
})

describe('the rule: a part’s allowance is measured from when it was fitted', () => {
  it('counts distance since the starting reading, not total mileage', () => {
    // A 12,000-mile guarantee on a clutch fitted at 90,000 is live at 95,000.
    const s = warrantyStatus(
      warranty({
        warrantyType: 'PART',
        distanceLimit: 12_000,
        distanceLimitUnit: 'MILES',
        startOdometer: 90_000,
        startOdometerUnit: 'MILES',
      }),
      odometer(95_000),
      TODAY,
    )
    expect(s.state).toBe('ACTIVE')
    expect(s.distanceRemaining).toBe(7_000)
  })

  it('expires once the allowance is used up', () => {
    const s = warrantyStatus(
      warranty({
        warrantyType: 'REPAIR',
        distanceLimit: 12_000,
        distanceLimitUnit: 'MILES',
        startOdometer: 90_000,
        startOdometerUnit: 'MILES',
      }),
      odometer(103_000),
      TODAY,
    )
    expect(s.state).toBe('EXPIRED')
    expect(s.governedBy).toBe('DISTANCE')
  })

  it('flags a part warranty with no starting reading instead of guessing', () => {
    // Without a start, 12,000 can only be read as an absolute odometer limit, which on a
    // 95,000-mile car says "expired" — plausible-looking and wrong.
    const s = warrantyStatus(
      warranty({ warrantyType: 'PART', distanceLimit: 12_000, distanceLimitUnit: 'MILES' }),
      odometer(95_000),
      TODAY,
    )
    expect(s.cautions).toContain('NO_START_ODOMETER')
  })

  it('does not flag a manufacturer warranty, whose limit IS an odometer reading', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(30_000),
      TODAY,
    )
    expect(s.cautions).toEqual([])
  })
})

describe('the rule: distances are converted, never compared raw', () => {
  it('compares a mile limit against a kilometre odometer correctly', () => {
    // 60,000 miles is 96,560 km. A car reading 90,000 km is still covered; comparing the
    // numbers raw would call it expired by 30,000.
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(90_000, 'KILOMETERS'),
      TODAY,
    )
    expect(s.state).toBe('ACTIVE')
    expect(s.distanceRemaining).toBeGreaterThan(0)
  })

  it('reports what is left in the unit the limit was written in', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 100_000, distanceLimitUnit: 'KILOMETERS' }),
      odometer(30_000, 'MILES'),
      TODAY,
    )
    // 30,000 miles is 48,280 km, leaving about 51,720 km.
    expect(s.distanceRemaining).toBeGreaterThan(51_000)
    expect(s.distanceRemaining).toBeLessThan(52_000)
  })

  it('handles a kilometre limit measured from a mile starting reading', () => {
    const s = warrantyStatus(
      warranty({
        warrantyType: 'PART',
        distanceLimit: 20_000,
        distanceLimitUnit: 'KILOMETERS',
        startOdometer: 50_000,
        startOdometerUnit: 'MILES',
      }),
      odometer(55_000, 'MILES'),
      TODAY,
    )
    // 5,000 miles driven is 8,047 km of a 20,000 km allowance.
    expect(s.state).toBe('ACTIVE')
    expect(s.distanceRemaining).toBeGreaterThan(11_900)
    expect(s.distanceRemaining).toBeLessThan(12_000)
  })
})

describe('the rule: say so when it cannot be worked out', () => {
  it('is UNKNOWN with neither an expiry nor a mileage limit', () => {
    const s = warrantyStatus(warranty({ expiresOn: null }), odometer(10_000), TODAY)
    expect(s.state).toBe('UNKNOWN')
    expect(s.governedBy).toBeNull()
  })

  it('flags a mileage limit that cannot be checked, and falls back to the date', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(null),
      TODAY,
    )
    expect(s.cautions).toContain('NO_ODOMETER')
    expect(s.distanceRemaining).toBeNull()
    // The date is still checkable, so a verdict is still given — with the caveat attached.
    expect(s.state).toBe('ACTIVE')
  })

  it('is UNKNOWN when the mileage cannot be checked AND there is no date', () => {
    const s = warrantyStatus(
      warranty({ expiresOn: null, distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(null),
      TODAY,
    )
    expect(s.state).toBe('UNKNOWN')
    expect(s.cautions).toContain('NO_ODOMETER')
  })

  it('reports a warranty that has not started yet', () => {
    const s = warrantyStatus(
      warranty({ startsOn: '2026-12-01', expiresOn: '2029-12-01' }),
      odometer(10_000),
      TODAY,
    )
    expect(s.state).toBe('NOT_STARTED')
    expect(s.daysRemaining).toBe(70)
  })

  it('treats the expiry day itself as still covered', () => {
    const s = warrantyStatus(warranty({ expiresOn: TODAY }), odometer(10_000), TODAY)
    expect(s.state).toBe('EXPIRING_SOON')
    expect(s.daysRemaining).toBe(0)
  })

  it('treats the exact mileage limit as still covered', () => {
    const s = warrantyStatus(
      warranty({ distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(60_000),
      TODAY,
    )
    expect(s.distanceRemaining).toBe(0)
    expect(s.state).toBe('EXPIRING_SOON')
  })
})

describe('the rule: the label names whichever clock will run out first', () => {
  it('points at the mileage on a high-mileage car with years left', () => {
    const s = warrantyStatus(
      warranty({ expiresOn: '2029-09-22', distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(58_000),
      TODAY,
    )
    expect(s.governedBy).toBe('DISTANCE')
  })

  it('points at the date on a low-mileage car', () => {
    const s = warrantyStatus(
      warranty({ expiresOn: '2027-01-01', distanceLimit: 60_000, distanceLimitUnit: 'MILES' }),
      odometer(5_000),
      TODAY,
    )
    expect(s.governedBy).toBe('DATE')
  })

  it('points at the date when there is no mileage limit at all', () => {
    expect(warrantyStatus(warranty(), odometer(10_000), TODAY).governedBy).toBe('DATE')
  })
})
