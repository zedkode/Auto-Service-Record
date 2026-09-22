/**
 * RPT-004 — the workspace seen as a fleet.
 *
 * `computeCostReport` answers what a workspace spent. This answers the question Maria in
 * PRODUCT.md §3.3 actually asks: *which* van is costing the most, and *which* one is about
 * to fail a renewal. That is a per-vehicle comparison plus a workspace total, not a
 * different calculation — so this reuses the cost engine's helpers rather than restating
 * its rules, which is the only way the fleet column and the per-vehicle report can be
 * guaranteed to agree.
 */
import {
  MIN_DAYS_TO_ANNUALISE,
  daysInclusive,
  distanceCovered,
  type DistanceUnavailable,
  type ReportExpense,
  type ReportOdometer,
} from './reports.engine.js'

const METRES_PER_MILE = 1609.344
const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2)

export interface FleetVehicle {
  id: string
  displayName: string
  registrationNumber: string | null
  status: string
}

/** A dated obligation that can lapse: an MOT, a policy or a tax period. */
export interface FleetObligation {
  vehicleId: string
  kind: 'INSPECTION' | 'INSURANCE' | 'TAX'
  expiresOn: string
}

export type ComplianceState = 'EXPIRED' | 'DUE_SOON' | 'OK' | 'UNKNOWN'

/**
 * Matches the reminder engine's lead time, so the fleet table and the reminder that lands
 * in somebody's inbox never disagree about whether a van is "due soon".
 */
export const DUE_SOON_DAYS = 30

export interface FleetVehicleRow {
  vehicleId: string
  displayName: string
  registrationNumber: string | null
  status: string

  total: string
  count: number
  share: number

  distance: {
    metres: number | null
    miles: number | null
    kilometres: number | null
    unavailableReason: DistanceUnavailable | null
  }
  costPerDistance: {
    perMile: string | null
    perKilometre: string | null
    unavailableReason: DistanceUnavailable | 'MIXED_CURRENCIES' | null
  }
  costPerYear: {
    amount: string | null
    projected: boolean
    unavailableReason: 'PERIOD_TOO_SHORT' | 'MIXED_CURRENCIES' | null
  }

  compliance: {
    state: ComplianceState
    /** The obligation that lapses first, which is the one worth acting on. */
    kind: FleetObligation['kind'] | null
    expiresOn: string | null
    daysRemaining: number | null
  }
}

export interface FleetReport {
  from: string
  to: string
  days: number

  currency: string | null
  mixedCurrencies: boolean

  fleet: {
    vehicleCount: number
    total: string
    entries: number
    distance: FleetVehicleRow['distance']
    costPerDistance: FleetVehicleRow['costPerDistance']
    costPerYear: FleetVehicleRow['costPerYear']
    /** Vehicles with something expired or lapsing within 30 days. */
    needingAttention: number
  }

  vehicles: FleetVehicleRow[]

  /**
   * Costs not attributable to any one vehicle. Reported separately rather than spread
   * across the fleet: an apportionment would be invented, and it would quietly change
   * every vehicle's cost per mile.
   */
  unassigned: { total: string; count: number }
}

function distanceOf(metres: number | null, reason: DistanceUnavailable | null) {
  return {
    metres,
    miles: metres === null ? null : round2(metres / METRES_PER_MILE),
    kilometres: metres === null ? null : round2(metres / 1000),
    unavailableReason: reason,
  }
}

function perDistance(
  total: number,
  metres: number | null,
  reason: DistanceUnavailable | null,
  mixedCurrencies: boolean,
) {
  if (mixedCurrencies) {
    return { perMile: null, perKilometre: null, unavailableReason: 'MIXED_CURRENCIES' as const }
  }
  if (metres === null) return { perMile: null, perKilometre: null, unavailableReason: reason }
  return {
    perMile: (total / (metres / METRES_PER_MILE)).toFixed(3),
    perKilometre: (total / (metres / 1000)).toFixed(3),
    unavailableReason: null,
  }
}

function perYear(total: number, days: number, mixedCurrencies: boolean) {
  if (mixedCurrencies) {
    return { amount: null, projected: false, unavailableReason: 'MIXED_CURRENCIES' as const }
  }
  // Same 90-day floor as the single-vehicle report (D-078): a van bought last month must
  // not appear in a fleet table with a wildly overstated annual cost beside its siblings.
  if (days < MIN_DAYS_TO_ANNUALISE) {
    return { amount: null, projected: false, unavailableReason: 'PERIOD_TOO_SHORT' as const }
  }
  return { amount: money((total / days) * 365), projected: days < 365, unavailableReason: null }
}

/** Whole days from `from` to `to`; negative once `to` is in the past. */
function daysUntil(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

function complianceOf(
  obligations: readonly FleetObligation[],
  asOf: string,
): FleetVehicleRow['compliance'] {
  if (obligations.length === 0) {
    // No MOT, policy or tax recorded is not the same as compliant, and must never be
    // shown as a green tick: it means nobody has told us.
    return { state: 'UNKNOWN', kind: null, expiresOn: null, daysRemaining: null }
  }

  const soonest = [...obligations].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0]!
  const remaining = daysUntil(asOf, soonest.expiresOn)
  const state: ComplianceState =
    remaining < 0 ? 'EXPIRED' : remaining <= DUE_SOON_DAYS ? 'DUE_SOON' : 'OK'
  return {
    state,
    kind: soonest.kind,
    expiresOn: soonest.expiresOn,
    daysRemaining: remaining,
  }
}

export function computeFleetReport(input: {
  from: string
  to: string
  asOf: string
  vehicles: readonly FleetVehicle[]
  expenses: readonly ReportExpense[]
  odometer: readonly ReportOdometer[]
  obligations: readonly FleetObligation[]
}): FleetReport {
  const { from, to, asOf, vehicles, expenses, odometer, obligations } = input
  const days = Math.max(1, daysInclusive(from, to))

  const currencies = new Set(expenses.map((e) => e.currency))
  const mixedCurrencies = currencies.size > 1
  const total = expenses.reduce((sum, e) => sum + e.amount, 0)
  const share = (value: number) => (total > 0 ? round2((value / total) * 100) : 0)

  const spendByVehicle = new Map<string, { total: number; count: number }>()
  let unassignedTotal = 0
  let unassignedCount = 0
  for (const e of expenses) {
    if (e.vehicleId === null) {
      unassignedTotal += e.amount
      unassignedCount += 1
      continue
    }
    const row = spendByVehicle.get(e.vehicleId) ?? { total: 0, count: 0 }
    row.total += e.amount
    row.count += 1
    spendByVehicle.set(e.vehicleId, row)
  }

  const readingsByVehicle = new Map<string, ReportOdometer[]>()
  for (const r of odometer) {
    const list = readingsByVehicle.get(r.vehicleId) ?? []
    list.push(r)
    readingsByVehicle.set(r.vehicleId, list)
  }

  const obligationsByVehicle = new Map<string, FleetObligation[]>()
  for (const o of obligations) {
    const list = obligationsByVehicle.get(o.vehicleId) ?? []
    list.push(o)
    obligationsByVehicle.set(o.vehicleId, list)
  }

  const rows: FleetVehicleRow[] = vehicles.map((v) => {
    const spend = spendByVehicle.get(v.id) ?? { total: 0, count: 0 }
    const covered = distanceCovered(readingsByVehicle.get(v.id) ?? [])
    return {
      vehicleId: v.id,
      displayName: v.displayName,
      registrationNumber: v.registrationNumber,
      status: v.status,
      total: money(spend.total),
      count: spend.count,
      share: share(spend.total),
      distance: distanceOf(covered.metres, covered.reason),
      costPerDistance: perDistance(spend.total, covered.metres, covered.reason, mixedCurrencies),
      costPerYear: perYear(spend.total, days, mixedCurrencies),
      compliance: complianceOf(obligationsByVehicle.get(v.id) ?? [], asOf),
    }
  })

  // Most expensive first: the question a fleet table is opened to answer.
  rows.sort((a, b) => Number(b.total) - Number(a.total))

  const fleetDistance = distanceCovered(odometer)

  return {
    from,
    to,
    days,
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    mixedCurrencies,
    fleet: {
      vehicleCount: vehicles.length,
      total: money(total),
      entries: expenses.length,
      distance: distanceOf(fleetDistance.metres, fleetDistance.reason),
      costPerDistance: perDistance(
        total,
        fleetDistance.metres,
        fleetDistance.reason,
        mixedCurrencies,
      ),
      costPerYear: perYear(total, days, mixedCurrencies),
      needingAttention: rows.filter(
        (r) => r.compliance.state === 'EXPIRED' || r.compliance.state === 'DUE_SOON',
      ).length,
    },
    vehicles: rows,
    unassigned: { total: money(unassignedTotal), count: unassignedCount },
  }
}
