import { describe, expect, it } from 'vitest'
import type { CalendarDate } from '@autoservices/types'
import { HORIZON_DAYS, latestPerVehicle, withinHorizon } from './expiry.sources.js'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const TODAY = '2026-09-21' as CalendarDate

describe('latestPerVehicle', () => {
  it('keeps only the record that protects the vehicle longest', () => {
    // The real case this exists for: years of MOT history on one vehicle. Emitting the
    // expired ones would nag the owner about obligations they already met.
    const rows = [
      { id: 'mot-2024', vehicleId: 'v1', expiresOn: d('2025-03-01') },
      { id: 'mot-2025', vehicleId: 'v1', expiresOn: d('2026-03-01') },
      { id: 'mot-2026', vehicleId: 'v1', expiresOn: d('2027-03-01') },
    ]
    expect(latestPerVehicle(rows).map((r) => r.id)).toEqual(['mot-2026'])
  })

  it('keeps one record per vehicle, not one overall', () => {
    const rows = [
      { id: 'a', vehicleId: 'v1', expiresOn: d('2026-10-01') },
      { id: 'b', vehicleId: 'v2', expiresOn: d('2026-11-01') },
    ]
    expect(
      latestPerVehicle(rows)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })

  it('ignores records with no expiry — they are not obligations', () => {
    const rows = [
      { id: 'no-expiry', vehicleId: 'v1', expiresOn: null },
      { id: 'real', vehicleId: 'v1', expiresOn: d('2026-10-01') },
    ]
    expect(latestPerVehicle(rows).map((r) => r.id)).toEqual(['real'])
  })

  it('returns nothing when no record has an expiry', () => {
    expect(latestPerVehicle([{ id: 'x', vehicleId: 'v1', expiresOn: null }])).toEqual([])
  })

  it('is not fooled by input order', () => {
    const ascending = [
      { id: 'old', vehicleId: 'v1', expiresOn: d('2025-01-01') },
      { id: 'new', vehicleId: 'v1', expiresOn: d('2027-01-01') },
    ]
    expect(latestPerVehicle(ascending).map((r) => r.id)).toEqual(['new'])
    expect(latestPerVehicle([...ascending].reverse()).map((r) => r.id)).toEqual(['new'])
  })
})

describe('withinHorizon', () => {
  it('includes an already-expired record', () => {
    expect(withinHorizon(d('2020-01-01'), TODAY)).toBe(true)
  })

  it('includes one expiring today', () => {
    expect(withinHorizon(d('2026-09-21'), TODAY)).toBe(true)
  })

  it('includes the last day of the horizon and excludes the day after', () => {
    expect(withinHorizon(d('2026-12-20'), TODAY)).toBe(true) // +90
    expect(withinHorizon(d('2026-12-21'), TODAY)).toBe(false) // +91
  })

  it('excludes a distant renewal', () => {
    expect(withinHorizon(d('2028-01-01'), TODAY)).toBe(false)
  })

  it('uses the documented horizon', () => {
    expect(HORIZON_DAYS).toBe(90)
  })
})
