/**
 * RPT-001/002 — cost aggregation, and the question the product exists to answer:
 * "what has this vehicle actually cost to own, per year and per mile?" (INIT.md §1).
 *
 * A pure function over rows already fetched, so every rule about when a figure is
 * *not* reportable can be tested without a database. Those rules matter more than the
 * arithmetic: a cost-per-mile computed from one odometer reading, or from a fortnight
 * extrapolated to a year, is worse than no figure at all.
 */

export type DistanceUnit = 'MILES' | 'KILOMETERS'

export interface ReportExpense {
  amount: number
  currency: string
  incurredOn: string
  vehicleId: string | null
  categoryKey: string | null
  categoryName: string | null
}

export interface ReportOdometer {
  vehicleId: string
  recordedOn: string
  value: number
  unit: DistanceUnit
}

const METRES_PER_MILE = 1609.344
const toMetres = (value: number, unit: DistanceUnit) =>
  unit === 'MILES' ? value * METRES_PER_MILE : value * 1000

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2)

/** Days between two ISO dates, inclusive of both ends. */
export function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.floor((b - a) / 86_400_000) + 1
}

export type DistanceUnavailable = 'NO_READINGS' | 'ONE_READING' | 'NO_MOVEMENT'

/**
 * Annualising a short period assumes costs are spread evenly, and vehicle costs are not:
 * one service or one insurance renewal in a six-week window would project into a wildly
 * overstated year. 90 days is the shortest window where the figure is worth showing, and
 * it is still labelled as a rate rather than a fact.
 */
export const MIN_DAYS_TO_ANNUALISE = 90

export interface CostReport {
  from: string
  to: string
  days: number

  total: string
  currency: string | null
  mixedCurrencies: boolean
  entries: number

  byCategory: Array<{ key: string; name: string; total: string; count: number; share: number }>
  byVehicle: Array<{ vehicleId: string | null; total: string; count: number; share: number }>
  /** One bucket per calendar month in the period, including months with no spend. */
  byMonth: Array<{ month: string; total: string; count: number }>

  distance: {
    metres: number | null
    miles: number | null
    kilometres: number | null
    unavailableReason: DistanceUnavailable | null
  }

  /** Null whenever the inputs cannot support an honest figure; the reason says which. */
  costPerDistance: {
    perMile: string | null
    perKilometre: string | null
    unavailableReason: DistanceUnavailable | 'MIXED_CURRENCIES' | null
  }

  costPerYear: {
    amount: string | null
    /** True when the period is shorter than a year and the figure is a projection. */
    projected: boolean
    unavailableReason: 'PERIOD_TOO_SHORT' | 'MIXED_CURRENCIES' | null
  }
}

/** Every calendar month touched by the period, as `YYYY-MM`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`)
  for (let d = start; d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

/**
 * Distance covered in the period, from the mileage history.
 *
 * Per vehicle, because two vehicles' odometers are unrelated numbers: summing them
 * directly would be meaningless, but the distance each one covered adds up fine.
 */
export function distanceCovered(readings: readonly ReportOdometer[]) {
  if (readings.length === 0) {
    return { metres: null, reason: 'NO_READINGS' as DistanceUnavailable }
  }

  const byVehicle = new Map<string, ReportOdometer[]>()
  for (const r of readings) {
    const list = byVehicle.get(r.vehicleId) ?? []
    list.push(r)
    byVehicle.set(r.vehicleId, list)
  }

  let total = 0
  let anyPair = false
  for (const list of byVehicle.values()) {
    if (list.length < 2) continue
    anyPair = true
    const metres = list.map((r) => toMetres(r.value, r.unit))
    total += Math.max(...metres) - Math.min(...metres)
  }

  if (!anyPair) return { metres: null, reason: 'ONE_READING' as DistanceUnavailable }
  // Readings exist but the vehicle did not move: dividing by this would be infinite.
  if (total <= 0) return { metres: null, reason: 'NO_MOVEMENT' as DistanceUnavailable }
  return { metres: total, reason: null }
}

export function computeCostReport(input: {
  from: string
  to: string
  expenses: readonly ReportExpense[]
  odometer: readonly ReportOdometer[]
}): CostReport {
  const { from, to, expenses, odometer } = input
  const days = Math.max(1, daysInclusive(from, to))

  const currencies = new Set(expenses.map((e) => e.currency))
  // No exchange rates exist in this platform, so a single total across currencies would
  // be invented (DECISIONS.md D-054).
  const mixedCurrencies = currencies.size > 1
  const total = expenses.reduce((sum, e) => sum + e.amount, 0)

  const categories = new Map<string, { name: string; total: number; count: number }>()
  const vehicles = new Map<string, { total: number; count: number }>()
  const months = new Map<string, { total: number; count: number }>()
  for (const m of monthsBetween(from, to)) months.set(m, { total: 0, count: 0 })

  for (const e of expenses) {
    const key = e.categoryKey ?? 'uncategorised'
    const cat = categories.get(key) ?? {
      name: e.categoryName ?? 'Uncategorised',
      total: 0,
      count: 0,
    }
    cat.total += e.amount
    cat.count += 1
    categories.set(key, cat)

    const vKey = e.vehicleId ?? 'workspace'
    const veh = vehicles.get(vKey) ?? { total: 0, count: 0 }
    veh.total += e.amount
    veh.count += 1
    vehicles.set(vKey, veh)

    const month = e.incurredOn.slice(0, 7)
    const bucket = months.get(month) ?? { total: 0, count: 0 }
    bucket.total += e.amount
    bucket.count += 1
    months.set(month, bucket)
  }

  // Share of the total, so a bar chart needs no arithmetic of its own. Zero when the
  // total is zero rather than NaN.
  const share = (value: number) => (total > 0 ? round2((value / total) * 100) : 0)

  const covered = distanceCovered(odometer)

  const costPerDistance = (() => {
    if (mixedCurrencies) {
      return { perMile: null, perKilometre: null, unavailableReason: 'MIXED_CURRENCIES' as const }
    }
    if (covered.metres === null) {
      return { perMile: null, perKilometre: null, unavailableReason: covered.reason }
    }
    const miles = covered.metres / METRES_PER_MILE
    const km = covered.metres / 1000
    return {
      perMile: (total / miles).toFixed(3),
      perKilometre: (total / km).toFixed(3),
      unavailableReason: null,
    }
  })()

  const costPerYear = (() => {
    if (mixedCurrencies) {
      return { amount: null, projected: false, unavailableReason: 'MIXED_CURRENCIES' as const }
    }
    if (days < MIN_DAYS_TO_ANNUALISE) {
      return { amount: null, projected: false, unavailableReason: 'PERIOD_TOO_SHORT' as const }
    }
    return {
      amount: money((total / days) * 365),
      projected: days < 365,
      unavailableReason: null,
    }
  })()

  return {
    from,
    to,
    days,
    total: money(total),
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    mixedCurrencies,
    entries: expenses.length,

    byCategory: [...categories.entries()]
      .map(([key, v]) => ({
        key,
        name: v.name,
        total: money(v.total),
        count: v.count,
        share: share(v.total),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),

    byVehicle: [...vehicles.entries()]
      .map(([id, v]) => ({
        vehicleId: id === 'workspace' ? null : id,
        total: money(v.total),
        count: v.count,
        share: share(v.total),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total)),

    byMonth: [...months.entries()]
      .map(([month, v]) => ({ month, total: money(v.total), count: v.count }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),

    distance: {
      metres: covered.metres === null ? null : round2(covered.metres),
      miles: covered.metres === null ? null : round2(covered.metres / METRES_PER_MILE),
      kilometres: covered.metres === null ? null : round2(covered.metres / 1000),
      unavailableReason: covered.reason,
    },
    costPerDistance,
    costPerYear,
  }
}
