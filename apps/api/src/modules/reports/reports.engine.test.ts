import { describe, expect, it } from 'vitest'
import {
  computeCostReport,
  MIN_DAYS_TO_ANNUALISE,
  type ReportExpense,
  type ReportOdometer,
} from './reports.engine.js'

const spend = (over: Partial<ReportExpense> = {}): ReportExpense => ({
  amount: 100,
  currency: 'GBP',
  incurredOn: '2026-01-15',
  vehicleId: 'v1',
  categoryKey: 'servicing',
  categoryName: 'Servicing & repairs',
  ...over,
})

const reading = (over: Partial<ReportOdometer> = {}): ReportOdometer => ({
  vehicleId: 'v1',
  recordedOn: '2026-01-01',
  value: 10_000,
  unit: 'KILOMETERS',
  ...over,
})

const report = (over: Partial<Parameters<typeof computeCostReport>[0]> = {}) =>
  computeCostReport({
    from: '2026-01-01',
    to: '2026-12-31',
    expenses: [],
    odometer: [],
    ...over,
  })

describe('totals and grouping', () => {
  it('totals the expenses given', () => {
    const r = report({ expenses: [spend({ amount: 100 }), spend({ amount: 49.5 })] })
    expect(r.total).toBe('149.50')
    expect(r.entries).toBe(2)
    expect(r.currency).toBe('GBP')
  })

  it('groups by category with a share of the total', () => {
    const r = report({
      expenses: [
        spend({ amount: 750, categoryKey: 'servicing', categoryName: 'Servicing' }),
        spend({ amount: 250, categoryKey: 'fuel', categoryName: 'Fuel' }),
      ],
    })
    expect(r.byCategory[0]).toMatchObject({ key: 'servicing', total: '750.00', share: 75 })
    expect(r.byCategory[1]).toMatchObject({ key: 'fuel', total: '250.00', share: 25 })
  })

  it('sorts categories by spend, largest first', () => {
    const r = report({
      expenses: [
        spend({ amount: 10, categoryKey: 'a' }),
        spend({ amount: 90, categoryKey: 'b' }),
        spend({ amount: 50, categoryKey: 'c' }),
      ],
    })
    expect(r.byCategory.map((c) => c.key)).toEqual(['b', 'c', 'a'])
  })

  it('groups an expense with no vehicle under the workspace', () => {
    const r = report({ expenses: [spend({ vehicleId: null })] })
    expect(r.byVehicle[0]!.vehicleId).toBeNull()
  })

  it('labels an uncategorised expense rather than dropping it', () => {
    const r = report({ expenses: [spend({ categoryKey: null, categoryName: null })] })
    expect(r.byCategory[0]).toMatchObject({ key: 'uncategorised', name: 'Uncategorised' })
    expect(r.total).toBe('100.00')
  })

  it('gives every month in the period a bucket, including empty ones', () => {
    // A chart with missing months lies about the shape of spending.
    const r = report({
      from: '2026-01-01',
      to: '2026-03-31',
      expenses: [spend({ incurredOn: '2026-03-02' })],
    })
    expect(r.byMonth.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(r.byMonth[0]!.total).toBe('0.00')
    expect(r.byMonth[2]!.total).toBe('100.00')
  })

  it('reports zero shares rather than NaN when nothing was spent', () => {
    const r = report()
    expect(r.total).toBe('0.00')
    expect(r.byCategory).toEqual([])
  })
})

describe('currencies are never mixed', () => {
  it('flags a period containing more than one currency', () => {
    const r = report({
      expenses: [spend({ currency: 'GBP' }), spend({ currency: 'EUR' })],
    })
    expect(r.mixedCurrencies).toBe(true)
    expect(r.currency).toBeNull()
  })

  it('refuses cost per distance when currencies are mixed', () => {
    const r = report({
      expenses: [spend({ currency: 'GBP' }), spend({ currency: 'EUR' })],
      odometer: [reading({ value: 10_000 }), reading({ value: 20_000 })],
    })
    expect(r.costPerDistance.perMile).toBeNull()
    expect(r.costPerDistance.unavailableReason).toBe('MIXED_CURRENCIES')
  })

  it('refuses cost per year when currencies are mixed', () => {
    const r = report({ expenses: [spend({ currency: 'GBP' }), spend({ currency: 'USD' })] })
    expect(r.costPerYear.amount).toBeNull()
    expect(r.costPerYear.unavailableReason).toBe('MIXED_CURRENCIES')
  })
})

describe('distance covered', () => {
  it('measures between the first and last reading', () => {
    const r = report({ odometer: [reading({ value: 10_000 }), reading({ value: 15_000 })] })
    expect(r.distance.kilometres).toBe(5000)
    expect(r.distance.unavailableReason).toBeNull()
  })

  it('SUMS PER VEHICLE — two odometers are unrelated numbers', () => {
    // Naively taking max-min across both vehicles would report 90,000 km.
    const r = report({
      odometer: [
        reading({ vehicleId: 'v1', value: 10_000 }),
        reading({ vehicleId: 'v1', value: 12_000 }),
        reading({ vehicleId: 'v2', value: 90_000 }),
        reading({ vehicleId: 'v2', value: 93_000 }),
      ],
    })
    expect(r.distance.kilometres).toBe(5000)
  })

  it('converts miles and kilometres to one canonical figure', () => {
    const r = report({
      odometer: [reading({ value: 0, unit: 'MILES' }), reading({ value: 100, unit: 'MILES' })],
    })
    expect(r.distance.miles).toBeCloseTo(100, 1)
    expect(r.distance.kilometres).toBeCloseTo(160.93, 1)
  })

  it('says NO_READINGS when there is no mileage history', () => {
    const r = report({ expenses: [spend()] })
    expect(r.distance.metres).toBeNull()
    expect(r.distance.unavailableReason).toBe('NO_READINGS')
    expect(r.costPerDistance.unavailableReason).toBe('NO_READINGS')
  })

  it('says ONE_READING when a single reading cannot bound a distance', () => {
    const r = report({ odometer: [reading()] })
    expect(r.distance.unavailableReason).toBe('ONE_READING')
  })

  it('says NO_MOVEMENT rather than dividing by zero', () => {
    const r = report({
      expenses: [spend()],
      odometer: [reading({ value: 10_000 }), reading({ value: 10_000 })],
    })
    expect(r.distance.unavailableReason).toBe('NO_MOVEMENT')
    expect(r.costPerDistance.perMile).toBeNull()
  })

  it('ignores a vehicle with one reading while using one that has two', () => {
    const r = report({
      odometer: [
        reading({ vehicleId: 'v1', value: 0 }),
        reading({ vehicleId: 'v1', value: 1000 }),
        reading({ vehicleId: 'v2', value: 5000 }),
      ],
    })
    expect(r.distance.kilometres).toBe(1000)
  })
})

describe('cost per distance', () => {
  it('answers the question the product exists to answer', () => {
    // £1,000 over 10,000 km = £0.10/km, about £0.161/mile.
    const r = report({
      expenses: [spend({ amount: 1000 })],
      odometer: [reading({ value: 0 }), reading({ value: 10_000 })],
    })
    expect(r.costPerDistance.perKilometre).toBe('0.100')
    expect(r.costPerDistance.perMile).toBe('0.161')
  })

  it('keeps three decimals, because per-mile costs are small numbers', () => {
    const r = report({
      expenses: [spend({ amount: 50 })],
      odometer: [reading({ value: 0 }), reading({ value: 10_000 })],
    })
    // Rounded to two this would read as £0.01 and lose a third of its meaning.
    expect(r.costPerDistance.perKilometre).toBe('0.005')
  })
})

describe('cost per year', () => {
  it('REFUSES to annualise a short period', () => {
    // One service in a fortnight would project to an absurd year.
    const r = report({
      from: '2026-01-01',
      to: '2026-01-14',
      expenses: [spend({ amount: 800 })],
    })
    expect(r.costPerYear.amount).toBeNull()
    expect(r.costPerYear.unavailableReason).toBe('PERIOD_TOO_SHORT')
  })

  it('annualises once the period is long enough, and says it is a projection', () => {
    const r = report({
      from: '2026-01-01',
      to: '2026-06-30', // 181 days
      expenses: [spend({ amount: 1000 })],
    })
    expect(Number(r.costPerYear.amount)).toBeCloseTo((1000 / 181) * 365, 0)
    expect(r.costPerYear.projected).toBe(true)
  })

  it('does not call a full year a projection', () => {
    const r = report({
      from: '2026-01-01',
      to: '2026-12-31',
      expenses: [spend({ amount: 2000 })],
    })
    expect(r.costPerYear.projected).toBe(false)
    // 1 Jan to 31 Dec inclusive is exactly 365 days, so the year's spend is unchanged.
    expect(r.costPerYear.amount).toBe('2000.00')
    expect(r.days).toBe(365)
  })

  it('uses the documented threshold', () => {
    expect(MIN_DAYS_TO_ANNUALISE).toBe(90)
    const justUnder = report({ from: '2026-01-01', to: '2026-03-30', expenses: [spend()] })
    const justOver = report({ from: '2026-01-01', to: '2026-03-31', expenses: [spend()] })
    expect(justUnder.costPerYear.amount).toBeNull()
    expect(justOver.costPerYear.amount).not.toBeNull()
  })
})
