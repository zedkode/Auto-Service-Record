import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  cn,
  formatDate,
  formatDistance,
  formatMoney,
  formatRelativeDays,
} from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { AddMileageDialog } from '../components/AddMileageDialog.js'
import { AddServiceDialog } from '../components/AddServiceDialog.js'
import { ServiceHistoryPanel } from '../components/ServiceHistoryPanel.js'
import { MaintenancePanel } from '../components/MaintenancePanel.js'
import { OwnershipPanel } from '../components/OwnershipPanel.js'
import { VehicleLifecycle } from '../components/VehicleLifecycle.js'
import { ExpensesPanel } from '../components/ExpensesPanel.js'
import { DocumentsPanel } from '../components/DocumentsPanel.js'
import { FuelPanel } from '../components/FuelPanel.js'
import { MAINTENANCE_TONE } from '../lib/maintenance-status.js'
import { Timeline } from '../components/Timeline.js'
import { IconGauge, IconPlus, IconWrench } from '../components/Icons.js'

/** Tabs are URL-addressable so they are linkable, refreshable and back-button correct. */
interface TabDef {
  id: string
  label: string
  /** Set when the tab is routed but its module is not built yet. */
  phase?: string
}

const TABS: readonly TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'mileage', label: 'Mileage' },
  { id: 'service', label: 'Service' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'documents', label: 'Documents' },
]

export function VehicleDetailPage() {
  const { vehicleId = '' } = useParams()
  const { workspace } = useSession()
  const [params, setParams] = useSearchParams()
  const [mileageOpen, setMileageOpen] = useState(false)
  const [serviceOpen, setServiceOpen] = useState(false)

  const tab = params.get('tab') ?? 'overview'
  const setTab = (id: string) => setParams({ tab: id }, { replace: true })

  const vehicle = useQuery({
    queryKey: ['vehicle', workspace.id, vehicleId],
    queryFn: () => api.vehicles.get(workspace.id, vehicleId),
  })

  const odometer = useQuery({
    queryKey: ['odometer-current', workspace.id, vehicleId],
    queryFn: () => api.vehicles.currentOdometer(workspace.id, vehicleId),
  })

  if (vehicle.isPending) return <DetailSkeleton />

  if (vehicle.error) {
    const err = vehicle.error
    const notFound = err instanceof ApiError && err.status === 404
    return (
      <Card className="mt-6">
        <ErrorState
          title={notFound ? 'Vehicle not found' : 'Could not load this vehicle'}
          message={
            notFound
              ? 'This vehicle does not exist, or it belongs to a different workspace.'
              : err instanceof ApiError
                ? err.message
                : 'Something went wrong.'
          }
          requestId={err instanceof ApiError ? err.requestId : undefined}
          onRetry={notFound ? undefined : () => void vehicle.refetch()}
        />
      </Card>
    )
  }

  const v = vehicle.data
  const name = `${v.manufacturer} ${v.model}`

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <Link to="/vehicles" className="text-[13px] text-content-secondary hover:text-accent">
          ← Vehicles
        </Link>
      </nav>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            {v.registrationNumber && (
              <span className="rounded border border-border-default bg-surface-sunken px-2 py-0.5 font-mono text-[12px] font-semibold tracking-wide">
                {v.registrationNumber}
              </span>
            )}
            {v.status !== 'ACTIVE' && <StatusBadge status="UNKNOWN" label={v.status} />}
          </div>
          <p className="mt-1 text-[13.5px] text-content-secondary">
            {[v.trim, v.modelYear, v.engineName, v.colour].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            icon={<IconGauge className="size-4" />}
            onClick={() => setMileageOpen(true)}
          >
            Add mileage
          </Button>
          <Button
            variant="primary"
            icon={<IconWrench className="size-4" />}
            onClick={() => setServiceOpen(true)}
          >
            Add service
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 overflow-x-auto border-b border-border-subtle">
        <div role="tablist" aria-label="Vehicle sections" className="flex min-w-max gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative whitespace-nowrap px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                tab === t.id
                  ? 'text-accent after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              {t.label}
              {t.phase && (
                <span className="ml-1.5 rounded border border-border-default px-1 py-px text-[10px] font-medium text-content-tertiary">
                  Soon
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <OverviewTab
          vehicle={v}
          odometer={odometer.data}
          onAddMileage={() => setMileageOpen(true)}
          onAddService={() => setServiceOpen(true)}
        />
      )}
      {tab === 'timeline' && <TimelineTab vehicleId={vehicleId} />}
      {tab === 'mileage' && <MileageTab vehicleId={vehicleId} onAdd={() => setMileageOpen(true)} />}
      {tab === 'service' && (
        <ServiceHistoryPanel vehicleId={vehicleId} onAddService={() => setServiceOpen(true)} />
      )}
      {tab === 'maintenance' && (
        <MaintenancePanel vehicleId={vehicleId} distanceUnit={v.distanceUnit} />
      )}
      {tab === 'ownership' && <OwnershipPanel vehicleId={vehicleId} />}
      {tab === 'expenses' && <ExpensesPanel vehicleId={vehicleId} />}
      {tab === 'documents' && <DocumentsPanel vehicleId={vehicleId} />}
      {tab === 'fuel' && <FuelPanel vehicleId={vehicleId} />}
      {![
        'overview',
        'timeline',
        'mileage',
        'service',
        'maintenance',
        'ownership',
        'expenses',
        'documents',
        'fuel',
      ].includes(tab) && (
        <Card>
          <EmptyState
            title={`${TABS.find((t) => t.id === tab)?.label} is not built yet`}
            description={`Scheduled for ${TABS.find((t) => t.id === tab)?.phase ?? 'a later phase'}. The tab exists so the structure is real, but there is no data behind it yet.`}
          />
        </Card>
      )}

      <AddMileageDialog
        open={mileageOpen}
        onClose={() => setMileageOpen(false)}
        vehicleId={vehicleId}
        defaultUnit={v.distanceUnit}
        currentValue={odometer.data?.value ?? null}
      />

      <AddServiceDialog
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        vehicleId={vehicleId}
        currentOdometer={odometer.data?.value ?? null}
        distanceUnit={v.distanceUnit}
        defaultCurrency={workspace.defaultCurrency}
      />
    </>
  )
}

function OverviewTab({
  vehicle: v,
  odometer,
  onAddMileage,
  onAddService,
}: {
  vehicle: Awaited<ReturnType<typeof api.vehicles.get>>
  odometer: Awaited<ReturnType<typeof api.vehicles.currentOdometer>> | undefined
  onAddMileage: () => void
  onAddService: () => void
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card>
          <CardHeader title="Identity" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Detail label="Manufacturer" value={v.manufacturer} />
              <Detail label="Model" value={v.model} />
              <Detail label="Trim" value={v.trim} />
              <Detail label="Year" value={v.modelYear} />
              <Detail label="Registration" value={v.registrationNumber} mono />
              <Detail label="VIN" value={v.vin} mono />
              <Detail label="Engine" value={v.engineName} />
              <Detail label="Engine code" value={v.engineCode} mono />
              <Detail
                label="Displacement"
                value={v.displacementCc ? `${v.displacementCc} cc` : null}
              />
              <Detail label="Power" value={v.powerKw ? `${v.powerKw} kW` : null} />
              <Detail label="Fuel" value={v.fuelType ? titleCase(v.fuelType) : null} />
              <Detail
                label="Transmission"
                value={v.transmission ? titleCase(v.transmission) : null}
              />
            </dl>
          </CardBody>
        </Card>

        <MaintenanceSummaryCard vehicleId={v.id} />
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Current mileage" />
          <CardBody>
            <p className="tabular text-[32px] font-semibold leading-none tracking-tight">
              {odometer?.value !== null && odometer?.value !== undefined
                ? new Intl.NumberFormat('en-GB').format(odometer.value)
                : '—'}
              <span className="ml-1.5 text-[14px] font-normal text-content-tertiary">
                {v.distanceUnit === 'MILES' ? 'miles' : 'km'}
              </span>
            </p>
            {odometer?.recordedOn && (
              <p className="mt-1.5 text-[12.5px] text-content-secondary">
                Recorded {formatDate(odometer.recordedOn)}
                {odometer.ageDays !== null && ` · ${formatRelativeDays(odometer.ageDays)}`}
              </p>
            )}
            {/* Staleness is surfaced honestly — a distance projection from a six-month-old
                reading is a guess, and the UI should say so (ARCHITECTURE.md §6). */}
            {odometer?.freshness === 'STALE' && (
              <div className="mt-3 rounded-md border border-status-due-soon/30 bg-status-due-soon-subtle px-3 py-2">
                <p className="text-[12.5px] font-medium text-status-due-soon">
                  This reading is out of date. Update it to keep future reminders accurate.
                </p>
              </div>
            )}
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onAddMileage}>
              Update mileage
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ownership" />
          <CardBody>
            <dl className="space-y-3">
              <Detail label="Purchased" value={v.purchasedOn ? formatDate(v.purchasedOn) : null} />
              <Detail
                label="Purchase price"
                value={formatMoney(v.purchasePrice, v.purchaseCurrency)}
              />
              <Detail
                label="First registered"
                value={v.firstRegisteredOn ? formatDate(v.firstRegisteredOn) : null}
              />
              <Detail label="Added" value={formatDate(v.createdAt.slice(0, 10))} />
            </dl>
          </CardBody>
        </Card>

        <CostCard vehicleId={v.id} />

        <Card>
          <CardHeader title="Quick actions" />
          <CardBody className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={onAddMileage}>
              Add mileage
            </Button>
            <Button variant="secondary" size="sm" onClick={onAddService}>
              Add service
            </Button>
            {['Add expense', 'Add document'].map((label) => (
              <Button
                key={label}
                variant="secondary"
                size="sm"
                disabled
                title="Not available yet — see the roadmap"
              >
                {label}
              </Button>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="This vehicle"
            description="Selling or storing a vehicle keeps its full history. Removing one hides it, and can be undone."
          />
          <CardBody>
            <VehicleLifecycle
              vehicleId={v.id}
              status={v.status}
              vehicleName={`${v.manufacturer} ${v.model}`}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function TimelineTab({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const timeline = useQuery({
    queryKey: ['timeline', workspace.id, vehicleId],
    queryFn: () => api.vehicles.timeline(workspace.id, vehicleId),
  })

  return (
    <Card>
      <CardHeader
        title="Timeline"
        description="Every recorded event, newest first. Services, inspections and costs join this stream as those modules ship."
      />
      <CardBody>
        {timeline.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : timeline.error ? (
          <ErrorState
            message="Could not load the timeline."
            onRetry={() => void timeline.refetch()}
          />
        ) : timeline.data.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Add a mileage reading to start this vehicle's history."
          />
        ) : (
          <Timeline events={timeline.data} />
        )}
      </CardBody>
    </Card>
  )
}

function MileageTab({ vehicleId, onAdd }: { vehicleId: string; onAdd: () => void }) {
  const { workspace } = useSession()
  const history = useQuery({
    queryKey: ['odometer', workspace.id, vehicleId],
    queryFn: () => api.vehicles.odometer(workspace.id, vehicleId),
  })

  return (
    <Card>
      <CardHeader
        title="Mileage history"
        description="Readings are never overwritten. A correction is recorded as a new, flagged entry."
        action={
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlus className="size-4" />}
            onClick={onAdd}
          >
            Add reading
          </Button>
        }
      />
      <CardBody className="px-0 pb-0">
        {history.isPending ? (
          <div className="space-y-2 px-5 pb-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : history.error ? (
          <ErrorState
            message="Could not load mileage history."
            onRetry={() => void history.refetch()}
          />
        ) : history.data.length === 0 ? (
          <EmptyState
            title="No readings yet"
            description="Record the current mileage to start tracking this vehicle."
            action={
              <Button variant="primary" onClick={onAdd}>
                Add reading
              </Button>
            }
          />
        ) : (
          <>
            {/* Table on desktop, stacked cards on mobile — horizontally scrolling a data
                table on a phone is a failure, not a fallback (UI_UX.md §4.2). */}
            <div className="hidden sm:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Reading
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Date
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Source
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {history.data.map((e) => (
                    <tr key={e.id}>
                      <td className="tabular px-5 py-2.5 font-medium">
                        {formatDistance(e.value, e.unit)}
                        {e.isCorrection && (
                          <span className="ml-2 rounded bg-status-due-soon-subtle px-1.5 py-px text-[11px] font-medium text-status-due-soon">
                            Correction
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-content-secondary">
                        {formatDate(e.recordedOn)}
                      </td>
                      <td className="px-5 py-2.5 text-content-tertiary">{titleCase(e.source)}</td>
                      <td className="px-5 py-2.5 text-content-secondary">
                        {e.correctionReason ?? e.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border-subtle border-t border-border-subtle sm:hidden">
              {history.data.map((e) => (
                <li key={e.id} className="px-5 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="tabular font-medium">{formatDistance(e.value, e.unit)}</span>
                    <span className="text-[12px] text-content-tertiary">
                      {formatDate(e.recordedOn)}
                    </span>
                  </div>
                  {(e.correctionReason ?? e.notes) && (
                    <p className="mt-1 text-[12.5px] text-content-secondary">
                      {e.correctionReason ?? e.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string | number | null | undefined
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-[13.5px] text-content-primary',
          mono && 'font-mono text-[12.5px]',
        )}
      >
        {value === null || value === undefined || value === '' ? (
          <span className="text-content-tertiary">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}

const titleCase = (v: string) =>
  v
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')

/** Live maintenance summary on the Overview tab — worst items first. */
function MaintenanceSummaryCard({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const [, setParams] = useSearchParams()
  const rules = useQuery({
    queryKey: ['maintenance', workspace.id, vehicleId],
    queryFn: () => api.maintenance.listForVehicle(workspace.id, vehicleId),
  })

  const active = (rules.data ?? []).filter((r) => r.isActive)
  const order = { OVERDUE: 0, DUE: 1, DUE_SOON: 2, OK: 3 } as const
  const top = [...active].sort((a, b) => order[a.status] - order[b.status]).slice(0, 5)

  return (
    <Card>
      <CardHeader
        title="Maintenance"
        description={
          rules.isPending
            ? undefined
            : active.length === 0
              ? 'No schedule configured yet.'
              : `${active.filter((r) => r.status !== 'OK').length} of ${active.length} need attention.`
        }
        action={
          <button
            type="button"
            onClick={() => setParams({ tab: 'maintenance' }, { replace: true })}
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            View all
          </button>
        }
      />
      <CardBody>
        {rules.isPending ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <p className="text-[13px] text-content-secondary">
            Open the Maintenance tab to start from suggested intervals.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {top.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-[13.5px]">{r.name}</span>
                <StatusBadge status={MAINTENANCE_TONE[r.status]} label={r.summary} />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

/** Real running costs — never a mocked total once real data exists (task brief §42). */
function CostCard({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const costs = useQuery({
    queryKey: ['cost-summary', workspace.id, vehicleId],
    queryFn: () => api.services.costSummary(workspace.id, vehicleId),
  })

  return (
    <Card>
      <CardHeader title="Running costs" description="From recorded services." />
      <CardBody>
        {costs.isPending ? (
          <Skeleton className="h-8 w-32" />
        ) : !costs.data?.length ? (
          <p className="text-[13px] text-content-secondary">
            No costs recorded yet. Add a service with a total to start tracking.
          </p>
        ) : (
          <ul className="space-y-2">
            {costs.data.map((c) => (
              <li key={c.currency} className="flex items-baseline justify-between">
                <span className="text-[12.5px] text-content-secondary">
                  {c.count} service{c.count === 1 ? '' : 's'}
                </span>
                <span className="tabular text-[20px] font-semibold tracking-tight">
                  {formatMoney(c.total, c.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
