/**
 * RPT-003 — is this car getting worse?
 *
 * The chart is twelve months of consumption; the sentence above it is the point. The
 * component renders what the API decided and never decides anything itself — including
 * whether a direction may be shown at all, which depends on rules (six months of data, a
 * 5% band, seasonal overlap) that belong in one place, next to the arithmetic.
 */
import { Card, CardBody, CardHeader } from '@autoservices/ui'
import type { FuelTrend, FuelTrendPoint } from '@autoservices/api-client'

const UNAVAILABLE: Record<string, string> = {
  NO_INTERVALS:
    'Consumption over time needs at least two full tanks. Record a fill each time you fuel up and this fills in by itself.',
  NOT_ENOUGH_MONTHS:
    'Not enough months yet to say which way consumption is going. Six months of fills is where a change stops being noise.',
  MIXED_ENERGY:
    'This vehicle has both fuel and charging recorded. Litres and kilowatt-hours cannot be averaged into one line, so no trend is shown.',
}

const CAUTION: Record<string, string> = {
  SEASONAL_OVERLAP:
    'Under a year of history, so some of this is the seasons — cold months use more fuel in a car that is working perfectly.',
  SPARSE_DATA: 'Some months rest on a single tank, which moves the line more than it should.',
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(period: string) {
  const [year, month] = period.split('-')
  return `${MONTH[Number(month) - 1] ?? period} ${year?.slice(2) ?? ''}`
}

const consumptionOf = (p: FuelTrendPoint) => (p.electric ? p.kwhPer100Km : p.litresPer100Km)

export function FuelTrendCard({ trend }: { trend: FuelTrend }) {
  const points = trend.points.filter((p) => consumptionOf(p) !== null)
  const unit = trend.electric ? 'kWh/100 km' : 'L/100 km'

  if (points.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader title="Consumption over time" />
        <CardBody className="pt-0">
          <p className="text-[13.5px] text-content-secondary">
            {UNAVAILABLE[trend.unavailableReason ?? 'NO_INTERVALS']}
          </p>
        </CardBody>
      </Card>
    )
  }

  // Bars are scaled from zero so their heights stay proportional to consumption. Starting
  // the axis at the minimum would turn a 2% drift into a dramatic cliff.
  const max = Math.max(...points.map((p) => consumptionOf(p)!))

  return (
    <Card className="mt-6">
      <CardHeader
        title="Consumption over time"
        description={`Each month's ${unit}, from the tanks that closed in it.`}
      />
      <CardBody className="pt-0">
        <Verdict trend={trend} unit={unit} />

        <div
          className="mt-5 flex items-end gap-1.5 sm:gap-2"
          role="img"
          aria-label={chartLabel(points, unit)}
        >
          {points.map((p) => {
            const value = consumptionOf(p)!
            return (
              <div key={p.period} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="tabular text-[11px] text-content-tertiary">{value}</span>
                <div
                  className="w-full rounded-t bg-accent/70"
                  style={{ height: `${Math.max(4, (value / max) * 96)}px` }}
                />
                <span className="truncate text-[10.5px] text-content-tertiary">
                  {monthLabel(p.period)}
                </span>
              </div>
            )
          })}
        </div>

        {trend.cautions.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-border-subtle pt-3">
            {trend.cautions.map((c) => (
              <li key={c} className="text-[12px] text-content-tertiary">
                {CAUTION[c]}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** A screen reader gets the numbers, not a description of the bars. */
function chartLabel(points: FuelTrendPoint[], unit: string) {
  return `Consumption by month in ${unit}: ${points
    .map((p) => `${monthLabel(p.period)} ${consumptionOf(p)}`)
    .join(', ')}`
}

function Verdict({ trend, unit }: { trend: FuelTrend; unit: string }) {
  if (!trend.direction) {
    return (
      <p className="text-[13.5px] text-content-secondary">
        {UNAVAILABLE[trend.unavailableReason ?? 'NOT_ENOUGH_MONTHS']}
      </p>
    )
  }

  const change = Math.abs(trend.changePercent ?? 0)
  const basis = trend.basis

  if (trend.direction === 'STABLE') {
    return (
      <p className="text-[13.5px] text-content-secondary">
        <span className="font-medium text-content-primary">Steady.</span> Consumption has changed by
        less than 5% over the last six months, which is normal variation between tanks.
      </p>
    )
  }

  const worse = trend.direction === 'WORSENING'
  return (
    <p className="text-[13.5px] text-content-secondary">
      <span
        className={worse ? 'font-medium text-status-overdue' : 'font-medium text-status-healthy'}
      >
        {worse ? `Using ${change}% more` : `Using ${change}% less`}
      </span>{' '}
      {trend.electric ? 'energy' : 'fuel'} per mile than three months ago
      {basis && (
        <span className="text-content-tertiary">
          {' '}
          ({monthLabel(basis.recent[0]!)}–{monthLabel(basis.recent[1]!)} against{' '}
          {monthLabel(basis.earlier[0]!)}–{monthLabel(basis.earlier[1]!)}, in {unit})
        </span>
      )}
      .
      {worse && (
        <span className="block mt-1.5 text-[12.5px]">
          Worth checking tyre pressures and whether a service is due — a real change of this size
          usually has a cause.
        </span>
      )}
    </p>
  )
}
