import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  formatDate,
  formatDistance,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'
import { MAINTENANCE_TONE } from '../lib/maintenance-status.js'

/** Workspace-wide maintenance: everything due or overdue, worst first. */
export function MaintenancePage() {
  const { workspace } = useSession()
  const due = useQuery({
    queryKey: ['maintenance-due', workspace.id],
    queryFn: () => api.maintenance.due(workspace.id),
  })

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Everything due or overdue across your vehicles, worst first."
      />

      <Card>
        <CardHeader
          title="Needs attention"
          description={
            due.data ? `${due.data.length} item${due.data.length === 1 ? '' : 's'}` : undefined
          }
        />
        <CardBody className="px-0 pb-0">
          {due.isPending ? (
            <div className="space-y-2 px-5 pb-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : due.error ? (
            <ErrorState
              message={
                due.error instanceof ApiError ? due.error.message : 'Could not load maintenance.'
              }
              onRetry={() => void due.refetch()}
            />
          ) : due.data.length === 0 ? (
            <EmptyState
              title="Nothing is due"
              description="Every maintenance item on every vehicle is up to date. Open a vehicle's Maintenance tab to review or adjust its schedule."
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
            <ul className="divide-y divide-border-subtle border-t border-border-subtle">
              {due.data.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/vehicles/${item.vehicle.id}?tab=maintenance`}
                    className="flex flex-wrap items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium">{item.name}</span>
                        <StatusBadge status={MAINTENANCE_TONE[item.status]} label={item.summary} />
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-content-secondary">
                        {item.vehicle.manufacturer} {item.vehicle.model}
                        {item.vehicle.registrationNumber && ` · ${item.vehicle.registrationNumber}`}
                        {item.nextDueOn && ` · due ${formatDate(item.nextDueOn)}`}
                        {item.nextDueOdometer !== null &&
                          ` · at ${formatDistance(item.nextDueOdometer, item.nextDueOdometerUnit ?? 'MILES')}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12.5px] font-medium text-accent">Open</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  )
}
