/**
 * RPT-004 — one row per vehicle, so a workspace with more than one car can be read as a
 * fleet: which one costs the most to run, and which one is about to lapse.
 *
 * Every figure here, including each "we cannot say" and the compliance state, is decided
 * by the API. The component chooses words and colours for them and nothing else.
 */
import { Link } from 'react-router'
import { Card, CardBody, CardHeader, EmptyState, formatMoney } from '@autoservices/ui'
import type { FleetReport, FleetVehicleRow } from '@autoservices/api-client'

const NO_DISTANCE: Record<string, string> = {
  NO_READINGS: 'No mileage recorded',
  ONE_READING: 'Only one reading',
  NO_MOVEMENT: 'No distance covered',
  MIXED_CURRENCIES: 'Mixed currencies',
  PERIOD_TOO_SHORT: 'Period too short',
}

const OBLIGATION: Record<string, string> = {
  INSPECTION: 'MOT',
  INSURANCE: 'Insurance',
  TAX: 'Road tax',
}

const COMPLIANCE_STYLE: Record<FleetVehicleRow['compliance']['state'], string> = {
  EXPIRED: 'bg-status-overdue-subtle text-status-overdue',
  DUE_SOON: 'bg-status-due-soon-subtle text-status-due-soon',
  OK: 'bg-status-healthy-subtle text-status-healthy',
  UNKNOWN: 'bg-status-neutral-subtle text-status-neutral',
}

function complianceLabel(c: FleetVehicleRow['compliance']) {
  if (c.state === 'UNKNOWN') return 'Nothing recorded'
  const what = OBLIGATION[c.kind ?? ''] ?? 'Renewal'
  if (c.state === 'EXPIRED') {
    const days = Math.abs(c.daysRemaining ?? 0)
    return `${what} expired ${days} day${days === 1 ? '' : 's'} ago`
  }
  if (c.state === 'DUE_SOON') {
    return `${what} due in ${c.daysRemaining} day${c.daysRemaining === 1 ? '' : 's'}`
  }
  return `${what} valid`
}

/**
 * The line under the heading. "Nothing lapsing in the next 30 days" is only true if
 * somebody has recorded when things lapse — said over a table of vehicles that all read
 * "Nothing recorded", it is a reassurance the data does not support.
 */
function summary(report: FleetReport) {
  const count = report.fleet.vehicleCount
  const vehicles = `${count} vehicle${count === 1 ? '' : 's'}`

  if (report.fleet.needingAttention > 0) {
    return `${report.fleet.needingAttention} of ${count} need attention — something has expired or is due within 30 days.`
  }

  const unknown = report.vehicles.filter((v) => v.compliance.state === 'UNKNOWN').length
  if (unknown === count) {
    return `${vehicles}. No MOT, insurance or tax dates recorded yet, so renewals cannot be tracked.`
  }
  if (unknown > 0) {
    return `${vehicles}, nothing lapsing in the next 30 days — but ${unknown} ${unknown === 1 ? 'has' : 'have'} no renewal dates recorded.`
  }
  return `${vehicles}, nothing lapsing in the next 30 days.`
}

export function FleetTable({ report, currency }: { report: FleetReport; currency: string }) {
  const money = (v: string | null) =>
    v === null ? '—' : formatMoney(v, report.currency ?? currency)

  if (report.vehicles.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader title="Every vehicle compared" />
        <EmptyState
          title="No vehicles yet"
          description="Add a vehicle and its costs will be compared here."
        />
      </Card>
    )
  }

  return (
    <Card className="mt-6 min-w-0">
      <CardHeader title="Every vehicle compared" description={summary(report)} />

      {/* A table on a wide screen; the same rows stack as cards on a phone. */}
      <div className="hidden overflow-x-auto border-t border-border-subtle sm:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-content-secondary">
              <th className="px-5 py-2.5 font-medium">Vehicle</th>
              <th className="px-3 py-2.5 text-right font-medium">Cost</th>
              <th className="px-3 py-2.5 text-right font-medium">Distance</th>
              <th className="px-3 py-2.5 text-right font-medium">Per mile</th>
              <th className="px-3 py-2.5 text-right font-medium">Per year</th>
              <th className="px-5 py-2.5 font-medium">Next renewal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
            {report.vehicles.map((v) => (
              <tr key={v.vehicleId}>
                <td className="max-w-[220px] px-5 py-3">
                  <Link
                    to={`/vehicles/${v.vehicleId}`}
                    className="truncate font-medium hover:text-accent hover:underline"
                  >
                    {v.displayName}
                  </Link>
                  {v.registrationNumber && (
                    <span className="ml-2 text-[12px] text-content-tertiary">
                      {v.registrationNumber}
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-3 text-right">
                  {report.mixedCurrencies ? '—' : money(v.total)}
                </td>
                <td className="tabular px-3 py-3 text-right">
                  {v.distance.miles === null ? (
                    <span className="text-[12px] text-content-tertiary">
                      {NO_DISTANCE[v.distance.unavailableReason ?? ''] ?? '—'}
                    </span>
                  ) : (
                    `${Math.round(v.distance.miles).toLocaleString()} mi`
                  )}
                </td>
                <td className="tabular px-3 py-3 text-right">
                  {v.costPerDistance.perMile === null ? (
                    <span className="text-[12px] text-content-tertiary">—</span>
                  ) : (
                    money(v.costPerDistance.perMile)
                  )}
                </td>
                <td className="tabular px-3 py-3 text-right">
                  {v.costPerYear.amount === null ? (
                    <span className="text-[12px] text-content-tertiary">
                      {NO_DISTANCE[v.costPerYear.unavailableReason ?? ''] ?? '—'}
                    </span>
                  ) : (
                    <>
                      {money(v.costPerYear.amount)}
                      {v.costPerYear.projected && (
                        <span className="ml-1 text-[11px] text-content-tertiary">est.</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-[12px] ${COMPLIANCE_STYLE[v.compliance.state]}`}
                  >
                    {complianceLabel(v.compliance)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border-subtle border-t border-border-subtle sm:hidden">
        {report.vehicles.map((v) => (
          <li key={v.vehicleId} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                to={`/vehicles/${v.vehicleId}`}
                className="min-w-0 truncate text-[13px] font-medium hover:text-accent"
              >
                {v.displayName}
              </Link>
              <p className="tabular shrink-0 text-[13px]">
                {report.mixedCurrencies ? '—' : money(v.total)}
              </p>
            </div>
            <p className="mt-1 text-[12px] text-content-secondary">
              {v.costPerDistance.perMile === null
                ? (NO_DISTANCE[v.costPerDistance.unavailableReason ?? ''] ?? 'No cost per mile')
                : `${money(v.costPerDistance.perMile)} per mile`}
            </p>
            <span
              className={`mt-1.5 inline-block rounded px-2 py-0.5 text-[12px] ${COMPLIANCE_STYLE[v.compliance.state]}`}
            >
              {complianceLabel(v.compliance)}
            </span>
          </li>
        ))}
      </ul>

      {Number(report.unassigned.total) > 0 && (
        <CardBody className="border-t border-border-subtle py-3">
          <p className="text-[12.5px] text-content-secondary">
            {money(report.unassigned.total)} across {report.unassigned.count} entr
            {report.unassigned.count === 1 ? 'y' : 'ies'} is not attached to any vehicle, so it is
            left out of the figures above rather than shared between them.
          </p>
        </CardBody>
      )}
    </Card>
  )
}
