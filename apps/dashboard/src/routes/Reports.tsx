import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  SelectField,
  Skeleton,
  TextField,
  formatDate,
  formatMoney,
} from '@autoservices/ui'
import { ApiError, type CostReport } from '@autoservices/api-client'
import { ExportPanel } from '../components/ExportPanel.js'
import { FleetTable } from '../components/FleetTable.js'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

/** Why a derived figure is missing. Every one of these is more useful than a dash. */
const NO_DISTANCE: Record<string, string> = {
  NO_READINGS: 'No mileage recorded in this period.',
  ONE_READING: 'Only one mileage reading — two are needed to measure a distance.',
  NO_MOVEMENT: 'The mileage did not change in this period.',
  MIXED_CURRENCIES: 'Costs are in more than one currency, so they cannot be combined.',
}
const NO_YEAR: Record<string, string> = {
  PERIOD_TOO_SHORT:
    'The period is under 90 days. Projecting it to a year would overstate lumpy costs like a service or a renewal.',
  MIXED_CURRENCIES: 'Costs are in more than one currency, so they cannot be combined.',
}

function yearToDate() {
  const now = new Date()
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

/**
 * RPT-001/002/005 — what the vehicles have cost, and what that works out at per mile and
 * per year.
 *
 * Every number here comes from the server, including the percentage shares the bars use.
 * A figure recomputed in the browser is a figure that can disagree with the same figure
 * elsewhere, and the rules about when NOT to show one are subtle enough that having them
 * in two places would guarantee drift.
 */
export function ReportsPage() {
  const { workspace } = useSession()
  const initial = yearToDate()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [vehicleId, setVehicleId] = useState('')

  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })
  const report = useQuery({
    queryKey: ['report-costs', workspace.id, from, to, vehicleId],
    queryFn: () => api.reports.costs(workspace.id, { from, to, vehicleId: vehicleId || undefined }),
  })
  /**
   * The fleet table answers a different question from the cost report — which vehicle,
   * rather than how much — so it is fetched separately and only when looking at the whole
   * workspace. Filtered to one vehicle, a one-row comparison table says nothing.
   */
  const fleet = useQuery({
    queryKey: ['report-fleet', workspace.id, from, to],
    queryFn: () => api.reports.fleet(workspace.id, { from, to }),
    enabled: vehicleId === '',
  })

  return (
    <>
      <PageHeader
        title="Reports"
        description={`What ${workspace.name} has cost, and what that works out at.`}
      />

      <Card className="mb-6">
        <CardBody className="py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              name="from"
              label="From"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              name="to"
              label="To"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <SelectField
              name="vehicleId"
              label="Vehicle"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">All vehicles</option>
              {(vehicles.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.manufacturer} {v.model}
                </option>
              ))}
            </SelectField>
          </div>
        </CardBody>
      </Card>

      {report.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : report.error ? (
        <Card>
          <ErrorState
            message={
              report.error instanceof ApiError
                ? report.error.message
                : 'Could not build the report.'
            }
            onRetry={() => void report.refetch()}
          />
        </Card>
      ) : (
        <>
          <ReportBody
            report={report.data}
            currency={workspace.defaultCurrency}
            showVehicleBreakdown={vehicleId !== '' || !fleet.data}
          />
          {/* `enabled` stops the refetch but keeps the last result cached, so the filter
              has to gate the render too — otherwise a stale all-vehicles table sits under
              a report that has been narrowed to one. */}
          {vehicleId === '' && fleet.data && (
            <FleetTable report={fleet.data} currency={workspace.defaultCurrency} />
          )}
          <ExportPanel from={from} to={to} />
        </>
      )}
    </>
  )
}

function ReportBody({
  report,
  currency,
  showVehicleBreakdown,
}: {
  report: CostReport
  currency: string
  /**
   * False when the fleet table is on the page. That table is a strict superset of this
   * breakdown — the same totals and shares, plus distance, cost per mile and what is about
   * to expire — and two adjacent cards both headed "By vehicle" is a worse page than
   * either one alone.
   */
  showVehicleBreakdown: boolean
}) {
  const money = (v: string | null) => formatMoney(v, report.currency ?? currency)

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardBody className="py-5">
            <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
              Total
            </p>
            {report.mixedCurrencies ? (
              <>
                <p className="mt-1.5 text-[15px] font-semibold">Multiple currencies</p>
                <p className="mt-1 text-[12.5px] text-content-secondary">
                  These costs were recorded in more than one currency, so they are not added
                  together.
                </p>
              </>
            ) : (
              <>
                <p className="tabular mt-2 text-3xl font-semibold leading-none tracking-tight">
                  {money(report.total)}
                </p>
                <p className="mt-2 text-[12.5px] text-content-secondary">
                  {report.entries} entr{report.entries === 1 ? 'y' : 'ies'} over {report.days} days
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-5">
            <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
              Per mile
            </p>
            {report.costPerDistance.perMile ? (
              <>
                <p className="tabular mt-2 text-3xl font-semibold leading-none tracking-tight">
                  {money(report.costPerDistance.perMile)}
                </p>
                <p className="mt-2 text-[12.5px] text-content-secondary">
                  {money(report.costPerDistance.perKilometre)} per km, over{' '}
                  {Math.round(report.distance.miles ?? 0).toLocaleString()} miles
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-content-secondary">
                {NO_DISTANCE[report.costPerDistance.unavailableReason ?? 'NO_READINGS']}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-5">
            <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
              Per year
            </p>
            {report.costPerYear.amount ? (
              <>
                <p className="tabular mt-2 text-3xl font-semibold leading-none tracking-tight">
                  {money(report.costPerYear.amount)}
                </p>
                <p className="mt-2 text-[12.5px] text-content-secondary">
                  {report.costPerYear.projected
                    ? 'At this rate — the period is under a year.'
                    : 'Measured over a full year.'}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[13px] text-content-secondary">
                {NO_YEAR[report.costPerYear.unavailableReason ?? 'PERIOD_TOO_SHORT']}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div
        className={`mt-6 grid items-start gap-6 ${showVehicleBreakdown ? 'xl:grid-cols-2' : ''}`}
      >
        <Breakdown
          title="By category"
          rows={report.byCategory.map((c) => ({
            key: c.key,
            name: c.name,
            total: c.total,
            share: c.share,
            count: c.count,
          }))}
          money={money}
          mixed={report.mixedCurrencies}
        />
        {showVehicleBreakdown && (
          <Breakdown
            title="By vehicle"
            rows={report.byVehicle.map((v) => ({
              key: v.vehicleId ?? 'workspace',
              name: v.name,
              total: v.total,
              share: v.share,
              count: v.count,
              href: v.vehicleId ? `/vehicles/${v.vehicleId}?tab=expenses` : undefined,
            }))}
            money={money}
            mixed={report.mixedCurrencies}
          />
        )}
      </div>

      <MonthlyCard report={report} money={money} />
    </>
  )
}

function Breakdown({
  title,
  rows,
  money,
  mixed,
}: {
  title: string
  rows: Array<{
    key: string
    name: string
    total: string
    share: number
    count: number
    href?: string
  }>
  money: (v: string | null) => string
  mixed: boolean
}) {
  return (
    <Card className="min-w-0">
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing in this period" description="Try a wider date range." />
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((r) => (
            <li key={r.key} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[13px] font-medium">
                  {r.href ? (
                    <Link to={r.href} className="hover:text-accent hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </p>
                <p className="tabular shrink-0 text-[13px]">
                  {mixed ? '—' : money(r.total)}
                  {!mixed && (
                    <span className="ml-2 text-[12px] text-content-tertiary">{r.share}%</span>
                  )}
                </p>
              </div>
              {!mixed && (
                <div className="mt-1.5 h-1 rounded-full bg-surface-sunken" role="presentation">
                  <div
                    className="h-1 rounded-full bg-accent"
                    style={{ width: `${Math.max(2, r.share)}%` }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function MonthlyCard({
  report,
  money,
}: {
  report: CostReport
  money: (v: string | null) => string
}) {
  const max = Math.max(...report.byMonth.map((m) => Number(m.total)), 1)
  return (
    <Card className="mt-6">
      <CardHeader
        title="Month by month"
        description="Every month in the period, including those with no spend."
      />
      <CardBody className="pt-4">
        <ol className="flex items-end gap-1.5" aria-label="Spend by month">
          {report.byMonth.map((m) => {
            const value = Number(m.total)
            const height = value > 0 ? Math.max(4, (value / max) * 100) : 2
            return (
              <li key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="sr-only">
                  {m.month}: {money(m.total)}
                </span>
                <div
                  className={
                    value > 0 ? 'w-full rounded-t bg-accent' : 'w-full rounded-t bg-border-subtle'
                  }
                  style={{ height: `${height}px` }}
                  title={`${m.month} · ${money(m.total)}`}
                  aria-hidden="true"
                />
                <span className="truncate text-[10.5px] text-content-tertiary" aria-hidden="true">
                  {m.month.slice(5)}
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mt-3 text-[12px] text-content-tertiary">
          {formatDate(report.from)} to {formatDate(report.to)}
        </p>
      </CardBody>
    </Card>
  )
}
