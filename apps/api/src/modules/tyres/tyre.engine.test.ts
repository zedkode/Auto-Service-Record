import { describe, expect, it } from 'vitest'
import {
  ADVISORY_TREAD_MM,
  LEGAL_MINIMUM_TREAD_MM,
  currentInstallation,
  distanceOnSet,
  treadStatus,
  type Installation,
} from './tyre.engine.js'

const TODAY = '2026-09-22'

const fitted = (over: Partial<Installation> = {}): Installation => ({
  installedOn: '2025-11-01',
  installedOdometer: 50_000,
  removedOn: '2026-04-01',
  removedOdometer: 54_000,
  odometerUnit: 'MILES',
  treadDepthMm: null,
  treadMeasuredOn: null,
  ...over,
})

const now = (odometer: number | null, unit: 'MILES' | 'KILOMETERS' = 'MILES') => ({
  odometer,
  unit: odometer === null ? null : unit,
})

describe('the rule: a set’s distance is the sum of every period it was fitted', () => {
  it('measures one complete period', () => {
    expect(distanceOnSet([fitted()], now(60_000)).miles).toBe(4_000)
  })

  it('adds up the winters', () => {
    // The case the whole model exists for: a seasonal set, on and off for three years.
    const r = distanceOnSet(
      [
        fitted({ installedOdometer: 50_000, removedOdometer: 54_000 }),
        fitted({ installedOdometer: 62_000, removedOdometer: 67_500 }),
        fitted({ installedOdometer: 74_000, removedOdometer: 78_000 }),
      ],
      now(90_000),
    )
    expect(r.miles).toBe(4_000 + 5_500 + 4_000)
    expect(r.measuredPeriods).toBe(3)
  })

  it('measures the open period against where the car is NOW', () => {
    const r = distanceOnSet(
      [fitted({ removedOn: null, removedOdometer: null, installedOdometer: 80_000 })],
      now(86_400),
    )
    // Not frozen at the moment it was fitted: the figure keeps up with the car.
    expect(r.miles).toBe(6_400)
  })

  it('combines closed periods with the open one', () => {
    const r = distanceOnSet(
      [
        fitted({ installedOdometer: 50_000, removedOdometer: 54_000 }),
        fitted({ installedOdometer: 62_000, removedOn: null, removedOdometer: null }),
      ],
      now(65_000),
    )
    expect(r.miles).toBe(4_000 + 3_000)
  })
})

describe('the rule: distances are converted, never compared raw', () => {
  it('handles a set fitted in km on a car now read in miles', () => {
    const r = distanceOnSet(
      [
        fitted({
          odometerUnit: 'KILOMETERS',
          installedOdometer: 80_000,
          removedOn: null,
          removedOdometer: null,
        }),
      ],
      now(56_000, 'MILES'),
    )
    // 80,000 km is 49,710 miles; 56,000 − 49,710 = 6,290 miles.
    expect(r.miles).toBeGreaterThan(6_280)
    expect(r.miles).toBeLessThan(6_300)
  })

  it('reports the same distance in both units', () => {
    const r = distanceOnSet([fitted()], now(60_000))
    expect(r.miles).toBe(4_000)
    expect(r.kilometres).toBe(6_437)
  })
})

describe('the rule: a total that is short says so', () => {
  it('counts periods it could not measure rather than dropping them silently', () => {
    const r = distanceOnSet(
      [
        fitted({ installedOdometer: 50_000, removedOdometer: 54_000 }),
        // Fitted, but nobody wrote down the mileage.
        fitted({ installedOdometer: null, removedOdometer: null }),
      ],
      now(60_000),
    )
    expect(r.miles).toBe(4_000)
    expect(r.measuredPeriods).toBe(1)
    expect(r.unmeasuredPeriods).toBe(1)
  })

  it('refuses a figure when nothing can be measured, and says which gap', () => {
    const r = distanceOnSet([fitted({ installedOdometer: null })], now(60_000))
    expect(r.miles).toBeNull()
    expect(r.unavailableReason).toBe('NO_INSTALL_READING')
  })

  it('refuses when the set is on the car and the car has no reading', () => {
    const r = distanceOnSet([fitted({ removedOn: null, removedOdometer: null })], now(null))
    expect(r.miles).toBeNull()
    expect(r.unavailableReason).toBe('NO_CURRENT_READING')
  })

  it('says NEVER_FITTED for a set that has never been on', () => {
    expect(distanceOnSet([], now(60_000)).unavailableReason).toBe('NEVER_FITTED')
  })

  it('never lets a corrected odometer make a set look newer', () => {
    // A period that appears to run backwards contributes nothing; it must not subtract.
    const r = distanceOnSet(
      [
        fitted({ installedOdometer: 50_000, removedOdometer: 54_000 }),
        fitted({ installedOdometer: 90_000, removedOdometer: 60_000 }),
      ],
      now(95_000),
    )
    expect(r.miles).toBe(4_000)
  })
})

describe('the rule: tread is measured, never predicted', () => {
  const withTread = (depthMm: number, measuredOn = '2026-09-01') =>
    treadStatus([fitted({ treadDepthMm: depthMm, treadMeasuredOn: measuredOn })], TODAY)

  it('calls anything under the legal minimum ILLEGAL', () => {
    expect(withTread(1.5).state).toBe('ILLEGAL')
    expect(LEGAL_MINIMUM_TREAD_MM).toBe(1.6)
  })

  it('treats the legal minimum itself as legal, but needing replacement', () => {
    // 1.6 mm is the limit, not an offence — but it is not a depth to leave alone.
    expect(withTread(LEGAL_MINIMUM_TREAD_MM).state).toBe('REPLACE_SOON')
  })

  it('advises replacement below 3 mm, well before the legal limit', () => {
    // Wet braking degrades sharply here, which is why the advisory threshold exists.
    expect(withTread(2.4).state).toBe('REPLACE_SOON')
    expect(ADVISORY_TREAD_MM).toBe(3)
  })

  it('says MONITOR just above the advisory depth, GOOD well above it', () => {
    expect(withTread(3.5).state).toBe('MONITOR')
    expect(withTread(6.0).state).toBe('GOOD')
  })

  it('uses the most recent measurement, not the first', () => {
    const r = treadStatus(
      [
        fitted({ treadDepthMm: 7.0, treadMeasuredOn: '2025-11-01' }),
        fitted({ treadDepthMm: 2.0, treadMeasuredOn: '2026-08-01' }),
      ],
      TODAY,
    )
    expect(r.depthMm).toBe(2.0)
    expect(r.state).toBe('REPLACE_SOON')
  })

  it('flags a reading old enough to be history rather than a current fact', () => {
    expect(withTread(5.0, '2026-09-01').stale).toBe(false)
    expect(withTread(5.0, '2025-01-01').stale).toBe(true)
  })

  it('is UNKNOWN with no measurement, and never guesses from mileage', () => {
    const r = treadStatus([fitted()], TODAY)
    expect(r.state).toBe('UNKNOWN')
    expect(r.depthMm).toBeNull()
  })
})

describe('which set is on the car', () => {
  it('is the period with no removal date', () => {
    const open = fitted({ removedOn: null, removedOdometer: null })
    expect(currentInstallation([fitted(), open])).toBe(open)
  })

  it('is nothing when every period has ended', () => {
    expect(currentInstallation([fitted(), fitted()])).toBeNull()
  })
})
