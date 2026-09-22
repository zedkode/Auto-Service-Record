import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  Card,
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

const UNIT_LABEL: Record<string, string> = {
  LITRES: 'L',
  US_GALLONS: 'US gal',
  IMP_GALLONS: 'gal',
  KWH: 'kWh',
}

/**
 * Fuel across the whole workspace: what each vehicle returns, and the recent fills.
 *
 * Recording a fill happens on the vehicle it belongs to, so this page deliberately has no
 * "add" action — a fill with no vehicle is not a fill.
 */
export function FuelPage() {
  const { workspace } = useSession()

  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })

  const perVehicle = useQueries({
    queries: (vehicles.data ?? []).map((v) => ({
      queryKey: ['fuel-economy', workspace.id, v.id],
      queryFn: () => api.fuel.economy(workspace.id, v.id),
    })),
  })
  const fills = useQueries({
    queries: (vehicles.data ?? []).map((v) => ({
      queryKey: ['fuel', workspace.id, v.id],
      queryFn: () => api.fuel.list(workspace.id, v.id),
    })),
  })

  if (vehicles.isPending) {
    return (
      <>
        <PageHeader title="Fuel" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </>
    )
  }
  if (vehicles.error) {
    return (
      <>
        <PageHeader title="Fuel" />
        <Card>
          <ErrorState
            message={
              vehicles.error instanceof ApiError ? vehicles.error.message : 'Could not load.'
            }
            onRetry={() => void vehicles.refetch()}
          />
        </Card>
      </>
    )
  }

  const named = vehicles.data.map((v, i) => ({
    vehicle: v,
    economy: perVehicle[i]?.data,
    fills: fills[i]?.data ?? [],
  }))
  const recent = named
    .flatMap((n) =>
      n.fills.map((f) => ({ ...f, vehicleName: `${n.vehicle.manufacturer} ${n.vehicle.model}` })),
    )
    .sort((a, b) => ((a.filledOn ?? '') < (b.filledOn ?? '') ? 1 : -1))
    .slice(0, 15)

  return (
    <>
      <PageHeader
        title="Fuel"
        description={`Consumption and fills across ${workspace.name}. Record a fill from the vehicle it belongs to.`}
      />

      <Card>
        <CardHeader title="Consumption by vehicle" description="Measured between full tanks." />
        {named.length === 0 ? (
          <EmptyState title="No vehicles yet" description="Add a vehicle to start tracking fuel." />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {named.map(({ vehicle, economy }) => {
              const avg = economy?.average
              const electric = avg?.electric ?? false
              return (
                <li key={vehicle.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/vehicles/${vehicle.id}?tab=fuel`}
                      className="truncate text-[13.5px] font-medium hover:text-accent hover:underline"
                    >
                      {vehicle.manufacturer} {vehicle.model}
                    </Link>
                    {vehicle.registrationNumber && (
                      <p className="font-mono text-[12px] text-content-tertiary">
                        {vehicle.registrationNumber}
                      </p>
                    )}
                  </div>
                  {avg ? (
                    <p className="tabular shrink-0 text-right text-[14px] font-semibold">
                      {electric ? avg.kwhPer100Km : avg.litresPer100Km}
                      <span className="ml-1 text-[12px] font-normal text-content-secondary">
                        {electric ? 'kWh/100 km' : 'L/100 km'}
                      </span>
                    </p>
                  ) : (
                    // Never a dash on its own: the reason is the useful part.
                    <p className="shrink-0 text-[12.5px] text-content-tertiary">
                      {economy?.unavailableReason === 'ONE_FULL_FILL'
                        ? 'needs a second full tank'
                        : 'no fills recorded'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Recent fills" description="Newest first, across every vehicle." />
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Open a vehicle and use its Fuel tab to record the first fill."
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {recent.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {f.quantity} {UNIT_LABEL[f.quantityUnit] ?? f.quantityUnit}
                    {!f.isFullTank && (
                      <span className="ml-2 text-[12px] font-normal text-content-tertiary">
                        partial
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12.5px] text-content-secondary">
                    {f.vehicleName}
                    {f.stationName && ` · ${f.stationName}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-[13px] font-medium">
                    {formatMoney(f.totalAmount, f.currency)}
                  </p>
                  <p className="text-[12px] text-content-secondary">{formatDate(f.filledOn)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
