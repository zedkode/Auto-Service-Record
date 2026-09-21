import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  formatDate,
  formatDistance,
  formatMoney,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'
import { ServiceDetailDialog } from '../components/ServiceDetailDialog.js'

/** Workspace-wide service history across every vehicle, with server-side filters. */
export function ServicesPage() {
  const { workspace } = useSession()
  const [search, setSearch] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })
  const categories = useQuery({
    queryKey: ['service-categories', workspace.id],
    queryFn: () => api.services.categories(workspace.id),
    staleTime: 10 * 60_000,
  })
  const services = useQuery({
    queryKey: ['services', workspace.id, { search, vehicleId, categoryId, dateFrom }],
    queryFn: () =>
      api.services.list(workspace.id, {
        q: search || undefined,
        vehicleId: vehicleId || undefined,
        categoryId: categoryId || undefined,
        dateFrom: dateFrom || undefined,
      }),
  })

  const hasFilters = Boolean(search || vehicleId || categoryId || dateFrom)
  const clear = () => {
    setSearch('')
    setVehicleId('')
    setCategoryId('')
    setDateFrom('')
  }

  const totals = new Map<string, number>()
  for (const s of services.data ?? []) {
    if (!s.totalAmount) continue
    totals.set(s.currency, (totals.get(s.currency) ?? 0) + Number(s.totalAmount))
  }

  return (
    <>
      <PageHeader
        title="Service history"
        description={`Every service recorded across ${workspace.name}.`}
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap gap-2 pt-4">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <input
            id="q"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description or workshop"
            className="h-9 min-w-56 flex-1 rounded-md border border-border-default bg-surface-raised px-3 text-sm placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <label htmlFor="veh" className="sr-only">
            Vehicle
          </label>
          <select
            id="veh"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="h-9 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
          >
            <option value="">All vehicles</option>
            {(vehicles.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.manufacturer} {v.model}
              </option>
            ))}
          </select>
          <label htmlFor="cat" className="sr-only">
            Category
          </label>
          <select
            id="cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-9 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="from" className="sr-only">
            From date
          </label>
          <input
            id="from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
          />
          {hasFilters && (
            <Button variant="ghost" onClick={clear}>
              Clear
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={
            services.data
              ? `${services.data.length} record${services.data.length === 1 ? '' : 's'}`
              : 'Records'
          }
          description={
            totals.size
              ? [...totals].map(([c, t]) => formatMoney(t.toFixed(2), c)).join(' · ') + ' total'
              : undefined
          }
        />
        <CardBody className="px-0 pb-0">
          {services.isPending ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : services.error ? (
            <ErrorState
              message={
                services.error instanceof ApiError
                  ? services.error.message
                  : 'Could not load services.'
              }
              onRetry={() => void services.refetch()}
            />
          ) : services.data.length === 0 && hasFilters ? (
            <EmptyState
              title="No services match these filters"
              description="Try widening your search."
              action={
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          ) : services.data.length === 0 ? (
            <EmptyState
              title="No services recorded yet"
              description="Open a vehicle and record its first service to start building history."
              action={
                <Link
                  to="/vehicles"
                  className="text-[13px] font-medium text-accent hover:underline"
                >
                  Go to your vehicles
                </Link>
              }
            />
          ) : (
            <>
              <div className="hidden sm:block">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                      <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                        Date
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                        Vehicle
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                        Service
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                        Mileage
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-2 text-right font-medium text-content-secondary"
                      >
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {services.data.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => setOpen(s.id)}
                        className="cursor-pointer hover:bg-surface-sunken"
                      >
                        <td className="whitespace-nowrap px-5 py-2.5 text-content-secondary">
                          {formatDate(s.performedOn)}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="font-medium">
                            {s.vehicle.manufacturer} {s.vehicle.model}
                          </span>
                          {s.vehicle.registrationNumber && (
                            <span className="ml-2 font-mono text-[11.5px] text-content-tertiary">
                              {s.vehicle.registrationNumber}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2.5">
                          {s.title}
                          {s.category && (
                            <span className="ml-2 rounded border border-border-default px-1.5 py-px text-[11px] text-content-tertiary">
                              {s.category.name}
                            </span>
                          )}
                        </td>
                        <td className="tabular whitespace-nowrap px-5 py-2.5 text-content-secondary">
                          {s.odometer !== null
                            ? formatDistance(s.odometer, s.odometerUnit ?? 'MILES')
                            : '—'}
                        </td>
                        <td className="tabular whitespace-nowrap px-5 py-2.5 text-right font-medium">
                          {formatMoney(s.totalAmount, s.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border-subtle border-t border-border-subtle sm:hidden">
                {services.data.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(s.id)}
                      className="w-full px-5 py-3 text-left hover:bg-surface-sunken"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{s.title}</span>
                        <span className="tabular shrink-0 font-medium">
                          {formatMoney(s.totalAmount, s.currency)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-content-secondary">
                        {s.vehicle.manufacturer} {s.vehicle.model} · {formatDate(s.performedOn)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <ServiceDetailDialog serviceId={open} onClose={() => setOpen(null)} vehicleId={vehicleId} />
    </>
  )
}
