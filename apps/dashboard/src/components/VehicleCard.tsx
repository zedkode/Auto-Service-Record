import { Link } from 'react-router'
import { StatusBadge, formatDate, cn } from '@autoservices/ui'
import type { VehicleSummary } from '@autoservices/api-client'

/**
 * A vehicle card must answer, without a click: what is it, what is its mileage, and does
 * it need attention (UI_UX.md §5.2). The left border reflects the worst status on it.
 */
export function VehicleCard({ vehicle, to }: { vehicle: VehicleSummary; to: string }) {
  const worst =
    vehicle.maintenanceStatus === 'OVERDUE' || vehicle.inspectionStatus === 'OVERDUE'
      ? 'border-l-status-overdue'
      : vehicle.maintenanceStatus === 'DUE_SOON' || vehicle.inspectionStatus === 'DUE_SOON'
        ? 'border-l-status-due-soon'
        : 'border-l-border-default'

  const name = [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ')

  return (
    <Link
      to={to}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border-subtle border-l-[3px] bg-surface-raised',
        'transition-colors duration-200 hover:border-accent focus-visible:border-accent',
        worst,
      )}
    >
      <VehicleImage vehicle={vehicle} />

      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-content-primary">{name}</h3>
            <p className="mt-0.5 truncate text-[12.5px] text-content-secondary">
              {[vehicle.trim, vehicle.modelYear].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          {vehicle.registrationNumber && <PlateBadge value={vehicle.registrationNumber} />}
        </div>

        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="tabular text-[22px] font-semibold leading-none tracking-tight text-content-primary">
            {vehicle.currentOdometer !== null
              ? new Intl.NumberFormat('en-GB').format(vehicle.currentOdometer)
              : '—'}
          </span>
          <span className="text-[12.5px] text-content-secondary">
            {vehicle.currentOdometerUnit === 'MILES' ? 'miles' : 'km'}
          </span>
        </div>
        {vehicle.currentOdometerAt && (
          <p className="mt-0.5 text-[11.5px] text-content-secondary">
            as of {formatDate(vehicle.currentOdometerAt)}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
          <StatusBadge status={vehicle.maintenanceStatus} label={maintenanceLabel(vehicle)} />
          <StatusBadge status={vehicle.inspectionStatus} label={inspectionLabel(vehicle)} />
        </div>
      </div>
    </Link>
  )
}

function maintenanceLabel(v: VehicleSummary): string {
  if (v.maintenanceStatus === 'UNKNOWN') return 'Service not tracked'
  return v.nextService?.label ?? 'Service'
}

function inspectionLabel(v: VehicleSummary): string {
  if (v.inspectionStatus === 'UNKNOWN') return 'MOT not tracked'
  return 'MOT'
}

function PlateBadge({ value }: { value: string }) {
  return (
    <span className="shrink-0 rounded border border-border-default bg-surface-sunken px-1.5 py-0.5 font-mono text-[11.5px] font-semibold tracking-wide text-content-secondary">
      {value}
    </span>
  )
}

/**
 * No stock photography and no decorative graphic — a neutral silhouette that says
 * "no image yet" (UI_UX.md §5.2).
 */
function VehicleImage({ vehicle }: { vehicle: VehicleSummary }) {
  return (
    <div className="relative aspect-[2/1] w-full overflow-hidden bg-surface-sunken">
      <div className="absolute inset-0 grid place-items-center">
        <svg
          viewBox="0 0 120 60"
          className="h-20 text-content-secondary"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 40h104" />
          <path d="M20 40v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6" />
          <path d="M85 40v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6" />
          <path d="M10 39 17 20a7 7 0 0 1 6.6-4.6h33.8A7 7 0 0 1 63 18l10 8h18a12 12 0 0 1 11 9l1 4" />
          <path d="M40 15v11" />
        </svg>
      </div>
      {vehicle.status !== 'ACTIVE' && (
        <span className="absolute left-3 top-3 rounded-full bg-surface-inverse/85 px-2 py-0.5 text-[11px] font-medium text-content-inverse">
          {vehicle.status}
        </span>
      )}
    </div>
  )
}
