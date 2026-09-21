import { dashboardCopy as copy } from '../lib/dashboard-copy.js'
import { can } from '@autoservices/permissions'
import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, buttonClassName, Card, EmptyState, ErrorState, Skeleton } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'
import { VehicleCard } from '../components/VehicleCard.js'
import { IconPlus } from '../components/Icons.js'

export function VehiclesPage() {
  const { workspace } = useSession()
  const [search, setSearch] = useState('')

  const vehicles = useQuery({
    queryKey: ['vehicles', workspace.id],
    queryFn: () => api.vehicles.list(workspace.id),
  })

  const filtered = (vehicles.data ?? []).filter((v) => {
    if (!search.trim()) return true
    const haystack = [v.manufacturer, v.model, v.trim, v.registrationNumber, v.modelYear]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(search.toLowerCase())
  })

  return (
    <>
      <PageHeader
        title="Vehicles"
        description={
          vehicles.data
            ? `${vehicles.data.length} vehicle${vehicles.data.length === 1 ? '' : 's'} in ${workspace.name}.`
            : undefined
        }
        action={
          can(workspace.role, 'vehicle:create') && (
            <Link to="/vehicles/new" className={buttonClassName({ variant: 'primary' })}>
              <IconPlus className="size-4" />
              Add vehicle
            </Link>
          )
        }
      />

      {(vehicles.data?.length ?? 0) > 0 && (
        <div className="mb-4">
          <label htmlFor="vehicle-search" className="sr-only">
            Search vehicles
          </label>
          <input
            id="vehicle-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by make, model, trim or registration"
            className="h-9 w-full max-w-md rounded-md border border-border-default bg-surface-raised px-3 text-sm placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      )}

      {vehicles.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="aspect-[16/9] rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : vehicles.error ? (
        <Card>
          <ErrorState
            message={
              vehicles.error instanceof ApiError
                ? vehicles.error.message
                : 'Could not load vehicles.'
            }
            requestId={vehicles.error instanceof ApiError ? vehicles.error.requestId : undefined}
            onRetry={() => void vehicles.refetch()}
          />
        </Card>
      ) : vehicles.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No vehicles yet"
            description={
              can(workspace.role, 'vehicle:create')
                ? 'Add your first vehicle to start building its history.'
                : copy.readOnlyEmpty
            }
            action={
              can(workspace.role, 'vehicle:create') && (
                <Link to="/vehicles/new" className={buttonClassName({ variant: 'primary' })}>
                  Add your first vehicle
                </Link>
              )
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        /* Distinct from "no vehicles": telling someone with 5 vehicles that they have
           none would be a bug (UI_UX.md §9). */
        <Card>
          <EmptyState
            title="No vehicles match your search"
            description={`Nothing matches “${search}”.`}
            action={
              <Button variant="secondary" onClick={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((v) => (
            <VehicleCard key={v.id} vehicle={v} to={`/vehicles/${v.id}`} />
          ))}
        </div>
      )}
    </>
  )
}
