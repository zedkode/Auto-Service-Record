import { useState } from 'react'
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
import { ApiError, type ServiceSummary } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { ServiceDetailDialog } from './ServiceDetailDialog.js'

export function ServiceHistoryPanel({
  vehicleId,
  onAddService,
}: {
  vehicleId: string
  onAddService: () => void
}) {
  const { workspace } = useSession()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [openService, setOpenService] = useState<string | null>(null)

  const categories = useQuery({
    queryKey: ['service-categories', workspace.id],
    queryFn: () => api.services.categories(workspace.id),
    staleTime: 10 * 60_000,
  })

  // Filtering happens server-side so it works beyond the first page.
  const services = useQuery({
    queryKey: ['vehicle-services', workspace.id, vehicleId, { search, categoryId }],
    queryFn: () =>
      api.services.listForVehicle(workspace.id, vehicleId, {
        q: search || undefined,
        categoryId: categoryId || undefined,
      }),
  })

  const hasFilters = Boolean(search || categoryId)

  return (
    <>
      <Card>
        <CardHeader
          title="Service history"
          description={
            services.data
              ? `${services.data.length} record${services.data.length === 1 ? '' : 's'}`
              : undefined
          }
          action={
            <Button variant="primary" size="sm" onClick={onAddService}>
              Add service
            </Button>
          }
        />

        {(services.data?.length ?? 0) > 0 || hasFilters ? (
          <div className="flex flex-wrap gap-2 px-5 pb-3">
            <label htmlFor="service-search" className="sr-only">
              Search services
            </label>
            <input
              id="service-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description or workshop"
              className="h-8 min-w-48 flex-1 rounded-md border border-border-default bg-surface-raised px-2.5 text-[13px] placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <label htmlFor="service-category" className="sr-only">
              Filter by category
            </label>
            <select
              id="service-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-8 rounded-md border border-border-default bg-surface-raised px-2 text-[13px]"
            >
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {hasFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setCategoryId('')
                }}
              >
                Clear
              </Button>
            )}
          </div>
        ) : null}

        <CardBody className="px-0 pb-0">
          {services.isPending ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : services.error ? (
            <ErrorState
              message={
                services.error instanceof ApiError
                  ? services.error.message
                  : 'Could not load services.'
              }
              requestId={services.error instanceof ApiError ? services.error.requestId : undefined}
              onRetry={() => void services.refetch()}
            />
          ) : services.data.length === 0 && hasFilters ? (
            /* Distinct from "no services at all" — telling someone with 20 records that
               they have none would be a bug (UI_UX.md §9). */
            <EmptyState
              title="No services match these filters"
              description="Try a different search term or category."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setCategoryId('')
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : services.data.length === 0 ? (
            <EmptyState
              title="No services recorded yet"
              description="Record your first service to start building this vehicle's maintenance history."
              action={
                <Button variant="primary" onClick={onAddService}>
                  Record first service
                </Button>
              }
            />
          ) : (
            <ServiceTable services={services.data} onOpen={setOpenService} />
          )}
        </CardBody>
      </Card>

      <ServiceDetailDialog
        serviceId={openService}
        onClose={() => setOpenService(null)}
        vehicleId={vehicleId}
      />
    </>
  )
}

function ServiceTable({
  services,
  onOpen,
}: {
  services: ServiceSummary[]
  onOpen: (id: string) => void
}) {
  return (
    <>
      {/* Table on desktop, stacked cards on mobile — horizontally scrolling a data table
          on a phone is a failure, not a fallback (UI_UX.md §4.2). */}
      <div className="hidden sm:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
              <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                Date
              </th>
              <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                Service
              </th>
              <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                Mileage
              </th>
              <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                Workshop
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium text-content-secondary">
                Cost
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {services.map((s) => (
              <tr
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="cursor-pointer transition-colors hover:bg-surface-sunken"
              >
                <td className="whitespace-nowrap px-5 py-2.5 text-content-secondary">
                  {formatDate(s.performedOn)}
                </td>
                <td className="px-5 py-2.5">
                  <span className="font-medium">{s.title}</span>
                  {s.category && (
                    <span className="ml-2 rounded border border-border-default px-1.5 py-px text-[11px] text-content-tertiary">
                      {s.category.name}
                    </span>
                  )}
                  {s.partCount > 0 && (
                    <span className="ml-2 text-[11.5px] text-content-tertiary">
                      {s.partCount} part{s.partCount === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
                <td className="tabular whitespace-nowrap px-5 py-2.5 text-content-secondary">
                  {s.odometer !== null
                    ? formatDistance(s.odometer, s.odometerUnit ?? 'MILES')
                    : '—'}
                </td>
                <td className="px-5 py-2.5 text-content-secondary">{s.workshopName ?? '—'}</td>
                <td className="tabular whitespace-nowrap px-5 py-2.5 text-right font-medium">
                  {formatMoney(s.totalAmount, s.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border-subtle border-t border-border-subtle sm:hidden">
        {services.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              className="w-full px-5 py-3 text-left transition-colors hover:bg-surface-sunken"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{s.title}</span>
                <span className="tabular shrink-0 font-medium">
                  {formatMoney(s.totalAmount, s.currency)}
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] text-content-secondary">
                {formatDate(s.performedOn)}
                {s.odometer !== null &&
                  ` · ${formatDistance(s.odometer, s.odometerUnit ?? 'MILES')}`}
                {s.workshopName && ` · ${s.workshopName}`}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
