import { can } from '@autoservices/permissions'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  buttonClassName,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  formatDate,
  formatMoney,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'
import { VerifyBanner } from '../components/VerifyBanner.js'
import { VehicleCard } from '../components/VehicleCard.js'
import { dashboardCopy as copy } from '../lib/dashboard-copy.js'
import { IconCar, IconBell, IconWrench, IconReceipt, IconPlus } from '../components/Icons.js'

export function OverviewPage() {
  const { workspace } = useSession()

  const dashboard = useQuery({
    queryKey: ['dashboard', workspace.id],
    queryFn: () => api.workspace.dashboard(workspace.id),
  })

  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })

  return (
    <>
      <p className="mb-2 text-xs font-semibold tracking-widest text-accent">{copy.eyebrow}</p>
      <PageHeader
        title={copy.overview}
        description={copy.workspace(workspace.name)}
        action={
          can(workspace.role, 'vehicle:create') && (
            <Link to="/vehicles/new" className={buttonClassName({ variant: 'primary' })}>
              <IconPlus className="size-4" />
              {copy.add}
            </Link>
          )
        }
      />

      <VerifyBanner />

      {/* Attention sits above everything. Its absence is information too. */}
      <AttentionPanel query={dashboard} />

      {(dashboard.isPending || (dashboard.data?.counts.vehicles ?? 0) > 0) && (
        <StatsRow query={dashboard} currency={workspace.defaultCurrency} />
      )}

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-3">
        <section className="min-w-0 xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{copy.vehicles}</h2>
              <p className="mt-1 text-sm text-content-secondary">{copy.vehiclesDescription}</p>
            </div>
            {(vehicles.data?.length ?? 0) > 0 && (
              <Link to="/vehicles" className="text-[13px] font-medium text-accent hover:underline">
                {copy.viewAll}
              </Link>
            )}
          </div>

          {vehicles.isPending ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="aspect-[2/1] rounded-none" />
                  <div className="space-y-2 p-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-6 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          ) : vehicles.error ? (
            <Card>
              <ErrorState
                message={
                  vehicles.error instanceof ApiError ? vehicles.error.message : copy.vehiclesError
                }
                requestId={
                  vehicles.error instanceof ApiError ? vehicles.error.requestId : undefined
                }
                onRetry={() => void vehicles.refetch()}
              />
            </Card>
          ) : vehicles.data.length === 0 ? (
            <Card>
              <EmptyState
                title={copy.noVehicles}
                description={
                  can(workspace.role, 'vehicle:create')
                    ? copy.noVehiclesDescription
                    : copy.readOnlyEmpty
                }
                action={
                  can(workspace.role, 'vehicle:create') && (
                    <Link to="/vehicles/new" className={buttonClassName({ variant: 'primary' })}>
                      {copy.addFirst}
                    </Link>
                  )
                }
              />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {vehicles.data.map((v) => (
                <VehicleCard key={v.id} vehicle={v} to={`/vehicles/${v.id}`} />
              ))}
            </div>
          )}
        </section>

        <RecentActivity query={dashboard} />
      </div>
    </>
  )
}

type DashboardQuery = ReturnType<
  typeof useQuery<Awaited<ReturnType<typeof api.workspace.dashboard>>>
>

function AttentionPanel({ query }: { query: DashboardQuery }) {
  if (query.isPending) return <Skeleton className="h-24 w-full rounded-lg" />
  if (query.error)
    return (
      <Card className="mb-6">
        <ErrorState
          message={copy.error}
          requestId={query.error instanceof ApiError ? query.error.requestId : undefined}
          onRetry={() => void query.refetch()}
        />
      </Card>
    )
  if (!query.data) return null

  const items = query.data.attention

  if (items.length === 0) {
    return (
      <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-status-healthy/25 bg-status-healthy-subtle px-4 py-3">
        <span className="text-status-healthy" aria-hidden="true">
          ✓
        </span>
        <p className="text-[13.5px] font-medium text-status-healthy">{copy.clear}</p>
      </div>
    )
  }

  return (
    <Card className="mb-6 overflow-hidden border-l-4 border-l-status-attention">
      <CardHeader title={copy.attention} description={copy.attentionCount(items.length)} />
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {items.map((item) => (
          <li key={`${item.vehicleId}-${item.title}`}>
            <Link
              to={item.action.href}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
            >
              <StatusBadge status={item.severity} label="" className="!px-1.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-content-primary">
                  {item.vehicleName}
                  {item.registrationNumber && (
                    <span className="ml-2 font-mono text-[11.5px] font-normal text-content-secondary">
                      {item.registrationNumber}
                    </span>
                  )}
                </p>
                <p className="text-[12.5px] text-content-secondary">
                  {item.title} — {item.detail}
                </p>
              </div>
              <span className="shrink-0 text-[12.5px] font-medium text-accent">
                {item.action.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function StatsRow({ query, currency }: { query: DashboardQuery; currency: string }) {
  if (query.error) return null
  const d = query.data
  const stats = [
    {
      label: copy.statsVehicles,
      value: d ? String(d.counts.vehicles) : null,
      hint: copy.vehicleHint,
      icon: IconCar,
    },
    {
      label: copy.statsAttention,
      value: d ? String(d.counts.attention) : null,
      hint: copy.attentionHint,
      icon: IconBell,
    },
    {
      label: copy.statsServices,
      value: d ? String(d.counts.servicesDue) : null,
      hint: copy.servicesHint,
      icon: IconWrench,
    },
    {
      label: copy.statsSpend,
      // A null total means nothing was recorded, or the amounts are in different
      // currencies and cannot honestly be added. Both say so rather than showing £0.00,
      // which the user would reasonably believe.
      value: d
        ? d.costs.mixedCurrencies
          ? '—'
          : formatMoney(d.costs.thisMonth, d.costs.currency ?? currency)
        : null,
      hint: d
        ? d.costs.mixedCurrencies
          ? copy.mixedCurrencies
          : d.costs.thisMonth === null
            ? copy.notTracked
            : null
        : null,
      icon: IconReceipt,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4 lg:p-5">
          <s.icon className="mb-4 size-5 text-content-secondary" />
          <p className="text-xs font-medium text-content-secondary">{s.label}</p>
          {query.isPending ? (
            <Skeleton className="mt-1.5 h-7 w-12" />
          ) : (
            <p className="tabular mt-2 text-2xl font-semibold leading-none tracking-tight">
              {s.value ?? '—'}
            </p>
          )}
          {s.hint && <p className="mt-2 text-xs text-content-secondary">{s.hint}</p>}
        </Card>
      ))}
    </div>
  )
}

function RecentActivity({ query }: { query: DashboardQuery }) {
  if (query.isPending) return <Skeleton className="h-32 w-full" />
  if (!query.data || query.error) return null
  const items = query.data.recentActivity

  return (
    <Card className="min-w-0">
      <CardHeader title={copy.activity} description={copy.activityDescription} />
      {items.length === 0 && (
        <EmptyState title={copy.noActivity} description={copy.noActivityDescription} />
      )}
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[13px]">
              <span className="font-medium">{a.vehicleName}</span>
              <span className="text-content-secondary"> — {a.title}</span>
            </p>
            <time dateTime={a.occurredOn} className="shrink-0 text-[12px] text-content-secondary">
              {formatDate(a.occurredOn)}
            </time>
          </li>
        ))}
      </ul>
    </Card>
  )
}
