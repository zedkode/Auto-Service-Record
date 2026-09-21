import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  formatDate,
  formatMoney,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

/** Month-to-date by default: the period the overview tile reports. */
function monthToDate() {
  const now = new Date()
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

function yearToDate() {
  const now = new Date()
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

const SOURCE_LABEL: Record<string, string> = {
  SERVICE: 'From service',
  INSURANCE: 'From insurance',
  TAX: 'From road tax',
  FUEL: 'From fuel',
  OTHER: 'Derived',
}

/**
 * RPT-001 groundwork — what the whole workspace has spent, and on what.
 *
 * Every figure comes from the server's summary, which reads the expense ledger and
 * nothing else, so a service is counted once rather than once per source (D-058).
 */
export function ExpensesPage() {
  const { workspace } = useSession()
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const range = period === 'month' ? monthToDate() : yearToDate()

  const summary = useQuery({
    queryKey: ['expense-summary', workspace.id, range.from, range.to],
    queryFn: () => api.expenses.summary(workspace.id, range.from, range.to),
  })
  const expenses = useQuery({
    queryKey: ['expenses-list', workspace.id, range.from, range.to],
    queryFn: () => api.expenses.list(workspace.id, { dateFrom: range.from, dateTo: range.to }),
  })

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`What ${workspace.name} has spent, including costs carried over from services, insurance and tax.`}
      />

      <div
        role="group"
        aria-label="Period"
        className="mb-5 inline-flex rounded-md border border-border-default p-0.5"
      >
        {(['month', 'year'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            aria-pressed={period === p}
            className={
              period === p
                ? 'rounded px-3 py-1.5 text-[13px] font-medium bg-accent text-content-inverse'
                : 'rounded px-3 py-1.5 text-[13px] font-medium text-content-secondary hover:bg-surface-sunken'
            }
          >
            {p === 'month' ? 'This month' : 'This year'}
          </button>
        ))}
      </div>

      {summary.isPending ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : summary.error ? (
        <Card>
          <ErrorState
            message={
              summary.error instanceof ApiError ? summary.error.message : 'Could not load totals.'
            }
            onRetry={() => void summary.refetch()}
          />
        </Card>
      ) : (
        <Card className="mb-6">
          <CardBody className="py-5">
            <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
              Total
            </p>
            {summary.data.mixedCurrencies ? (
              // No exchange rates exist in the platform, so a single figure would be
              // invented (DECISIONS.md D-054).
              <>
                <p className="mt-1 text-[15px] font-semibold">Multiple currencies</p>
                <p className="mt-1 text-[12.5px] text-content-secondary">
                  These costs were recorded in more than one currency, so they are not added
                  together.
                </p>
              </>
            ) : (
              <p className="tabular mt-2 text-3xl font-semibold leading-none tracking-tight">
                {formatMoney(
                  summary.data.total,
                  summary.data.currency ?? workspace.defaultCurrency,
                )}
              </p>
            )}
            <p className="mt-2 text-[12.5px] text-content-secondary">
              {summary.data.entries} entr{summary.data.entries === 1 ? 'y' : 'ies'} ·{' '}
              {formatDate(summary.data.from)} to {formatDate(summary.data.to)}
            </p>
          </CardBody>
        </Card>
      )}

      {summary.data && summary.data.entries > 0 && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <BreakdownCard
            title="By category"
            rows={summary.data.byCategory.map((c) => ({
              key: c.key,
              name: c.name,
              total: c.total,
              count: c.count,
            }))}
            currency={summary.data.currency ?? workspace.defaultCurrency}
            mixed={summary.data.mixedCurrencies}
          />
          <BreakdownCard
            title="By vehicle"
            rows={summary.data.byVehicle.map((v) => ({
              key: v.vehicleId ?? 'workspace',
              name: v.name,
              total: v.total,
              count: v.count,
              href: v.vehicleId ? `/vehicles/${v.vehicleId}?tab=expenses` : undefined,
            }))}
            currency={summary.data.currency ?? workspace.defaultCurrency}
            mixed={summary.data.mixedCurrencies}
          />
        </div>
      )}

      <Card>
        <CardHeader title="All costs" description="Newest first." />
        {expenses.isPending ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : expenses.error ? (
          <ErrorState message="Could not load costs." onRetry={() => void expenses.refetch()} />
        ) : expenses.data.length === 0 ? (
          <EmptyState
            title="Nothing recorded in this period"
            description="Record a service with a total, or add a cost on a vehicle, and it will appear here."
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {expenses.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {e.description ?? e.categoryName ?? 'Cost'}
                  </p>
                  <p className="truncate text-[12.5px] text-content-secondary">
                    {[e.vehicleName, e.categoryName, e.vendorName].filter(Boolean).join(' · ') ||
                      '—'}
                  </p>
                </div>
                {e.isProjected && (
                  <Badge className="shrink-0">{SOURCE_LABEL[e.sourceType] ?? 'Derived'}</Badge>
                )}
                <div className="shrink-0 text-right">
                  <p className="tabular text-[13px] font-medium">
                    {formatMoney(e.amount, e.currency)}
                  </p>
                  <p className="text-[12px] text-content-secondary">{formatDate(e.incurredOn)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function BreakdownCard({
  title,
  rows,
  currency,
  mixed,
}: {
  title: string
  rows: Array<{ key: string; name: string; total: string; count: number; href?: string }>
  currency: string
  mixed: boolean
}) {
  const max = Math.max(...rows.map((r) => Number(r.total)), 1)
  return (
    <Card className="min-w-0">
      <CardHeader title={title} />
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
                {mixed ? '—' : formatMoney(r.total, currency)}
              </p>
            </div>
            {!mixed && (
              <div className="mt-1.5 h-1 rounded-full bg-surface-sunken" role="presentation">
                <div
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${Math.max(2, (Number(r.total) / max) * 100)}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}
