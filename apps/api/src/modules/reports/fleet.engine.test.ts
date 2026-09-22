import { describe, expect, it } from 'vitest'
import {
  computeFleetReport,
  DUE_SOON_DAYS,
  type FleetObligation,
  type FleetVehicle,
} from './fleet.engine.js'
import type { ReportExpense, ReportOdometer } from './reports.engine.js'

const van = (id: string, name: string): FleetVehicle => ({
  id,
  displayName: name,
  registrationNumber: name.toUpperCase().slice(0, 7),
  status: 'ACTIVE',
})

const spend = (
  vehicleId: string | null,
  amount: number,
  incurredOn = '2026-03-01',
): ReportExpense => ({
  amount,
  currency: 'GBP',
  incurredOn,
  vehicleId,
  categoryKey: 'servicing',
  categoryName: 'Servicing & repairs',
})

const reading = (vehicleId: string, value: number, recordedOn: string): ReportOdometer => ({
  vehicleId,
  recordedOn,
  value,
  unit: 'MILES',
})

const YEAR = { from: '2026-01-01', to: '2026-12-31', asOf: '2026-06-01' }

describe('the rule: every van is comparable with every other', () => {
  it('reports each vehicle on its own costs, distance and cost per mile', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit'), van('b', 'Vivaro')],
      expenses: [spend('a', 1000), spend('b', 500)],
      odometer: [
        reading('a', 10_000, '2026-01-10'),
        reading('a', 20_000, '2026-06-10'),
        reading('b', 5_000, '2026-01-10'),
        reading('b', 15_000, '2026-06-10'),
      ],
      obligations: [],
    })

    const [first, second] = r.vehicles
    // Sorted by spend, so the expensive one is the row you read first.
    expect(first!.displayName).toBe('Transit')
    expect(first!.total).toBe('1000.00')
    expect(first!.distance.miles).toBe(10_000)
    expect(first!.costPerDistance.perMile).toBe('0.100')
    expect(second!.costPerDistance.perMile).toBe('0.050')
  })

  it('gives a vehicle with no costs a real zero, not an absence', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit'), van('b', 'Idle')],
      expenses: [spend('a', 100)],
      odometer: [],
      obligations: [],
    })
    const idle = r.vehicles.find((v) => v.vehicleId === 'b')!
    expect(idle.total).toBe('0.00')
    expect(idle.count).toBe(0)
    expect(idle.share).toBe(0)
  })

  it('shares sum to the whole when every cost is assigned', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'A'), van('b', 'B'), van('c', 'C')],
      expenses: [spend('a', 500), spend('b', 300), spend('c', 200)],
      odometer: [],
      obligations: [],
    })
    expect(r.vehicles.reduce((s, v) => s + v.share, 0)).toBeCloseTo(100, 2)
  })
})

describe('the rule: a cost that belongs to no vehicle is never spread across them', () => {
  it('holds workspace costs apart, and out of every per-vehicle figure', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit')],
      expenses: [spend('a', 100), spend(null, 900)],
      odometer: [reading('a', 0, '2026-01-01'), reading('a', 1000, '2026-06-01')],
      obligations: [],
    })
    expect(r.unassigned).toEqual({ total: '900.00', count: 1 })
    expect(r.vehicles[0]!.total).toBe('100.00')
    // The van's cost per mile must not carry a share of an expense that is not its own.
    expect(r.vehicles[0]!.costPerDistance.perMile).toBe('0.100')
    // But the fleet total is everything that was spent.
    expect(r.fleet.total).toBe('1000.00')
  })
})

describe('the rule: an unreportable figure says which one and why', () => {
  it('refuses cost per mile for a van with one reading', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit')],
      expenses: [spend('a', 100)],
      odometer: [reading('a', 10_000, '2026-02-01')],
      obligations: [],
    })
    expect(r.vehicles[0]!.costPerDistance.perMile).toBeNull()
    expect(r.vehicles[0]!.costPerDistance.unavailableReason).toBe('ONE_READING')
  })

  it('refuses cost per mile for a van that did not move', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Parked')],
      expenses: [spend('a', 100)],
      odometer: [reading('a', 10_000, '2026-02-01'), reading('a', 10_000, '2026-05-01')],
      obligations: [],
    })
    expect(r.vehicles[0]!.costPerDistance.unavailableReason).toBe('NO_MOVEMENT')
  })

  it('refuses to annualise a period under 90 days, for the fleet and for each van', () => {
    const r = computeFleetReport({
      from: '2026-01-01',
      to: '2026-02-01',
      asOf: '2026-02-01',
      vehicles: [van('a', 'Transit')],
      expenses: [spend('a', 1000, '2026-01-15')],
      odometer: [],
      obligations: [],
    })
    expect(r.vehicles[0]!.costPerYear.unavailableReason).toBe('PERIOD_TOO_SHORT')
    expect(r.fleet.costPerYear.unavailableReason).toBe('PERIOD_TOO_SHORT')
  })

  it('refuses every money-per-something figure when currencies are mixed', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit')],
      expenses: [spend('a', 100), { ...spend('a', 100), currency: 'EUR' }],
      odometer: [reading('a', 0, '2026-01-01'), reading('a', 1000, '2026-06-01')],
      obligations: [],
    })
    // No exchange rates exist in this platform, so a combined figure would be invented.
    expect(r.mixedCurrencies).toBe(true)
    expect(r.currency).toBeNull()
    expect(r.vehicles[0]!.costPerDistance.unavailableReason).toBe('MIXED_CURRENCIES')
    expect(r.fleet.costPerYear.unavailableReason).toBe('MIXED_CURRENCIES')
  })
})

describe('the rule: compliance is about what lapses first', () => {
  const obligation = (kind: FleetObligation['kind'], expiresOn: string): FleetObligation => ({
    vehicleId: 'a',
    kind,
    expiresOn,
  })

  const withObligations = (obligations: FleetObligation[]) =>
    computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'Transit')],
      expenses: [],
      odometer: [],
      obligations,
    }).vehicles[0]!.compliance

  it('reports the soonest expiry, not the first one recorded', () => {
    const c = withObligations([
      obligation('INSURANCE', '2026-12-01'),
      obligation('INSPECTION', '2026-07-01'),
      obligation('TAX', '2026-09-01'),
    ])
    expect(c.kind).toBe('INSPECTION')
    expect(c.expiresOn).toBe('2026-07-01')
  })

  it('calls a lapsed obligation EXPIRED, with the overrun as a negative', () => {
    const c = withObligations([obligation('INSPECTION', '2026-05-01')])
    expect(c.state).toBe('EXPIRED')
    expect(c.daysRemaining).toBe(-31)
  })

  it('warns at the same 30 days as the reminder that lands in the inbox', () => {
    const inside = withObligations([obligation('TAX', '2026-06-30')])
    const outside = withObligations([obligation('TAX', '2026-07-02')])
    expect(inside.daysRemaining).toBe(DUE_SOON_DAYS - 1)
    expect(inside.state).toBe('DUE_SOON')
    expect(outside.state).toBe('OK')
  })

  it('treats the boundary day itself as due soon', () => {
    expect(withObligations([obligation('TAX', '2026-07-01')]).state).toBe('DUE_SOON')
  })

  it('never shows a vehicle with nothing recorded as compliant', () => {
    const c = withObligations([])
    // UNKNOWN, not OK: it means nobody has told us, which is a different fact and one a
    // fleet manager needs to chase rather than tick off.
    expect(c.state).toBe('UNKNOWN')
    expect(c.expiresOn).toBeNull()
  })

  it('counts the vehicles needing attention, expired and due soon alike', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'A'), van('b', 'B'), van('c', 'C'), van('d', 'D')],
      expenses: [],
      odometer: [],
      obligations: [
        { vehicleId: 'a', kind: 'INSPECTION', expiresOn: '2026-01-01' },
        { vehicleId: 'b', kind: 'TAX', expiresOn: '2026-06-15' },
        { vehicleId: 'c', kind: 'INSURANCE', expiresOn: '2027-01-01' },
        // d has nothing recorded: unknown, which is not "needing attention" in this count
        // because the count is about renewals with a date on them.
      ],
    })
    expect(r.fleet.needingAttention).toBe(2)
  })
})

describe('the rule: the fleet total agrees with the vehicles under it', () => {
  it('adds up, including the unassigned column', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'A'), van('b', 'B')],
      expenses: [spend('a', 250.5), spend('b', 100.25), spend(null, 49.25)],
      odometer: [],
      obligations: [],
    })
    const vehicles = r.vehicles.reduce((s, v) => s + Number(v.total), 0)
    expect(vehicles + Number(r.unassigned.total)).toBeCloseTo(Number(r.fleet.total), 2)
    expect(r.fleet.total).toBe('400.00')
  })

  it('measures fleet distance as the sum of what each vehicle covered', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [van('a', 'A'), van('b', 'B')],
      expenses: [],
      odometer: [
        reading('a', 1000, '2026-01-01'),
        reading('a', 3000, '2026-06-01'),
        reading('b', 500, '2026-01-01'),
        reading('b', 1500, '2026-06-01'),
      ],
      obligations: [],
    })
    expect(r.fleet.distance.miles).toBe(3000)
    // And never as max-minus-min across vehicles, which would be meaningless.
    expect(r.vehicles.reduce((s, v) => s + (v.distance.miles ?? 0), 0)).toBe(3000)
  })

  it('handles an empty workspace without inventing anything', () => {
    const r = computeFleetReport({
      ...YEAR,
      vehicles: [],
      expenses: [],
      odometer: [],
      obligations: [],
    })
    expect(r.fleet.total).toBe('0.00')
    expect(r.fleet.vehicleCount).toBe(0)
    expect(r.fleet.costPerDistance.unavailableReason).toBe('NO_READINGS')
    expect(r.vehicles).toEqual([])
  })
})
