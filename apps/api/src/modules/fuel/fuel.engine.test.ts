import { describe, expect, it } from 'vitest'
import { computeEconomy, type FuelFill } from './fuel.engine.js'

/** A full 50-litre fill at the given mileage, unless overridden. */
const fill = (over: Partial<FuelFill> & { id: string; odometer: number }): FuelFill => ({
  filledOn: '2026-09-01',
  odometerUnit: 'KILOMETERS',
  quantity: 50,
  quantityUnit: 'LITRES',
  isFullTank: true,
  missedFill: false,
  ...over,
})

describe('the rule: only full-to-full is measurable', () => {
  it('produces nothing from no fills', () => {
    const r = computeEconomy([])
    expect(r.average).toBeNull()
    expect(r.unavailableReason).toBe('NO_FILLS')
  })

  it('produces nothing from a single full fill', () => {
    // One fill establishes a starting point and measures nothing.
    const r = computeEconomy([fill({ id: 'a', odometer: 1000 })])
    expect(r.average).toBeNull()
    expect(r.unavailableReason).toBe('ONE_FULL_FILL')
  })

  it('measures the interval between two full fills', () => {
    // 500 km on 50 litres = 10 L/100km exactly.
    const r = computeEconomy([fill({ id: 'a', odometer: 1000 }), fill({ id: 'b', odometer: 1500 })])
    expect(r.intervals).toHaveLength(1)
    expect(r.intervals[0]!.litresPer100Km).toBe(10)
    expect(r.intervals[0]!.kmPerLitre).toBe(10)
    expect(r.average!.litresPer100Km).toBe(10)
  })

  it('EXCLUDES the opening fill’s own fuel from the interval', () => {
    // The tank was filled at 1000 and filled again at 1500. What was burned over those
    // 500 km is what the SECOND fill put in, not the first.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000, quantity: 999 }),
      fill({ id: 'b', odometer: 1500, quantity: 50 }),
    ])
    expect(r.intervals[0]!.quantity).toBe(50)
    expect(r.intervals[0]!.litresPer100Km).toBe(10)
  })

  it('never uses a partial fill as an endpoint', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'p', odometer: 1200, isFullTank: false, quantity: 20 }),
    ])
    expect(r.intervals).toHaveLength(0)
    expect(r.average).toBeNull()
  })

  it('ACCUMULATES a partial fill into the interval that ends at the next full fill', () => {
    // 1000 → 1500 km, fuel bought in between: 20 (partial) + 30 (full) = 50 litres.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'p', odometer: 1200, isFullTank: false, quantity: 20 }),
      fill({ id: 'b', odometer: 1500, quantity: 30 }),
    ])
    expect(r.intervals).toHaveLength(1)
    expect(r.intervals[0]!.quantity).toBe(50)
    expect(r.intervals[0]!.fillCount).toBe(2)
    expect(r.intervals[0]!.litresPer100Km).toBe(10)
  })

  it('accumulates several consecutive partials', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'p1', odometer: 100, isFullTank: false, quantity: 10 }),
      fill({ id: 'p2', odometer: 200, isFullTank: false, quantity: 10 }),
      fill({ id: 'p3', odometer: 300, isFullTank: false, quantity: 10 }),
      fill({ id: 'b', odometer: 1000, quantity: 20 }),
    ])
    expect(r.intervals[0]!.quantity).toBe(50)
    expect(r.intervals[0]!.fillCount).toBe(4)
    expect(r.intervals[0]!.litresPer100Km).toBe(5)
  })

  it('chains consecutive intervals across three full fills', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 500 }),
      fill({ id: 'c', odometer: 1000 }),
    ])
    expect(r.intervals).toHaveLength(2)
    expect(r.intervals.map((i) => [i.fromFillId, i.toFillId])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
  })
})

describe('data that cannot be trusted is excluded, with a reason', () => {
  it('skips an interval containing a missed fill', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'b', odometer: 1500, missedFill: true }),
    ])
    expect(r.intervals).toHaveLength(0)
    expect(r.skipped[0]!.reason).toBe('MISSED_FILL')
    expect(r.unavailableReason).toBe('NO_USABLE_INTERVAL')
  })

  it('skips when a partial inside the window was a missed fill', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'p', odometer: 1200, isFullTank: false, missedFill: true }),
      fill({ id: 'b', odometer: 1500 }),
    ])
    expect(r.skipped[0]!.reason).toBe('MISSED_FILL')
  })

  it('skips an interval with no distance', () => {
    // Two fills at the same mileage: dividing by zero would report infinite economy.
    const r = computeEconomy([fill({ id: 'a', odometer: 1000 }), fill({ id: 'b', odometer: 1000 })])
    expect(r.intervals).toHaveLength(0)
    expect(r.skipped[0]!.reason).toBe('NO_DISTANCE')
  })

  it('skips an interval with no fuel recorded', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'b', odometer: 1500, quantity: 0 }),
    ])
    expect(r.skipped[0]!.reason).toBe('NO_QUANTITY')
  })

  it('REFUSES to add litres and kWh in the same interval', () => {
    // A plug-in hybrid charged and fuelled between two full fills. Adding them would be
    // adding different physical quantities; picking one understates the other.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000 }),
      fill({ id: 'kwh', odometer: 1200, isFullTank: false, quantity: 30, quantityUnit: 'KWH' }),
      fill({ id: 'b', odometer: 1500, quantity: 30 }),
    ])
    expect(r.intervals).toHaveLength(0)
    expect(r.skipped[0]!.reason).toBe('MIXED_ENERGY')
  })

  it('keeps good intervals when one is bad', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 500 }),
      fill({ id: 'c', odometer: 1000, missedFill: true }),
      fill({ id: 'd', odometer: 1500 }),
    ])
    expect(r.intervals.map((i) => i.toFillId)).toEqual(['b', 'd'])
    expect(r.skipped.map((s) => s.reason)).toEqual(['MISSED_FILL'])
  })
})

describe('ordering', () => {
  it('orders by odometer, not by the order given', () => {
    const r = computeEconomy([fill({ id: 'b', odometer: 1500 }), fill({ id: 'a', odometer: 1000 })])
    expect(r.intervals[0]!.fromFillId).toBe('a')
    expect(r.intervals[0]!.litresPer100Km).toBe(10)
  })

  it('orders by odometer, not by date — a fill logged late still happened at its mileage', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 1000, filledOn: '2026-09-10' }),
      fill({ id: 'b', odometer: 1500, filledOn: '2026-09-01' }),
    ])
    // Ordering by date would make this interval -500 km.
    expect(r.intervals[0]!.distanceMetres).toBeGreaterThan(0)
    expect(r.intervals[0]!.fromFillId).toBe('a')
  })
})

describe('units', () => {
  it('converts miles to a correct metric figure', () => {
    // 300 miles = 482.8032 km on 40 litres.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0, odometerUnit: 'MILES' }),
      fill({ id: 'b', odometer: 300, odometerUnit: 'MILES', quantity: 40 }),
    ])
    expect(r.intervals[0]!.litresPer100Km).toBeCloseTo(8.28, 1)
    // 300 miles on 40 litres ≈ 8.8 imperial gallons ≈ 34 mpg.
    expect(r.intervals[0]!.milesPerImperialGallon).toBeCloseTo(34.1, 0)
  })

  it('converts imperial gallons', () => {
    // 10 imperial gallons = 45.4609 litres over 454.609 km = exactly 10 L/100km.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 454.609, quantity: 10, quantityUnit: 'IMP_GALLONS' }),
    ])
    expect(r.intervals[0]!.litresPer100Km).toBeCloseTo(10, 2)
  })

  it('converts US gallons, which are not imperial gallons', () => {
    // The difference is ~20%: getting this wrong is a visibly wrong number, not a rounding
    // error.
    const us = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 1000, quantity: 10, quantityUnit: 'US_GALLONS' }),
    ])
    const imp = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 1000, quantity: 10, quantityUnit: 'IMP_GALLONS' }),
    ])
    expect(us.intervals[0]!.quantity).toBeCloseTo(37.854, 2)
    expect(imp.intervals[0]!.quantity).toBeCloseTo(45.461, 2)
    expect(us.intervals[0]!.litresPer100Km).toBeLessThan(imp.intervals[0]!.litresPer100Km!)
  })

  it('handles an electric vehicle with the same interval logic', () => {
    // 40 kWh over 200 km = 20 kWh/100km.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0, quantityUnit: 'KWH', quantity: 40 }),
      fill({ id: 'b', odometer: 200, quantityUnit: 'KWH', quantity: 40 }),
    ])
    expect(r.intervals[0]!.electric).toBe(true)
    expect(r.intervals[0]!.kwhPer100Km).toBe(20)
    expect(r.intervals[0]!.milesPerKwh).toBeCloseTo(3.11, 1)
    // Litres figures are meaningless for an EV and are not invented.
    expect(r.intervals[0]!.litresPer100Km).toBeNull()
    expect(r.average!.electric).toBe(true)
  })

  it('accumulates partial charges for an EV exactly as for fuel', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0, quantityUnit: 'KWH', quantity: 40 }),
      fill({ id: 'p', odometer: 100, quantityUnit: 'KWH', quantity: 10, isFullTank: false }),
      fill({ id: 'b', odometer: 200, quantityUnit: 'KWH', quantity: 30 }),
    ])
    expect(r.intervals[0]!.quantity).toBe(40)
    expect(r.intervals[0]!.kwhPer100Km).toBe(20)
  })
})

describe('the average', () => {
  it('weights by distance, not by interval count', () => {
    // A 100 km interval at 20 L/100km and a 900 km interval at 10 L/100km.
    // Mean of the figures would be 15; the honest answer is 11.
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 100, quantity: 20 }),
      fill({ id: 'c', odometer: 1000, quantity: 90 }),
    ])
    expect(r.intervals).toHaveLength(2)
    expect(r.average!.litresPer100Km).toBe(11)
  })

  it('reports total distance and quantity behind the average', () => {
    const r = computeEconomy([
      fill({ id: 'a', odometer: 0 }),
      fill({ id: 'b', odometer: 500, quantity: 50 }),
    ])
    expect(r.average!.distanceMetres).toBe(500_000)
    expect(r.average!.quantity).toBe(50)
  })
})
