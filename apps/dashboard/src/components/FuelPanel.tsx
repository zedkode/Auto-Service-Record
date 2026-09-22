import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  formatDate,
  formatMoney,
} from '@autoservices/ui'
import { ApiError, type FuelEconomy, type FuelEntry } from '@autoservices/api-client'
import { FuelTrendCard } from './FuelTrendCard.js'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

const UNIT_LABEL: Record<string, string> = {
  LITRES: 'L',
  US_GALLONS: 'US gal',
  IMP_GALLONS: 'gal',
  KWH: 'kWh',
}

/**
 * Why there is no consumption figure yet. Spelled out rather than left blank, because
 * "we cannot tell you yet, and here is why" is information; an empty box is not.
 */
const UNAVAILABLE: Record<string, string> = {
  NO_FILLS: 'Record a fill to start tracking consumption.',
  ONE_FULL_FILL:
    'One full tank recorded. Consumption can be worked out from the next full fill — the distance between two full tanks is what makes it measurable.',
  NO_USABLE_INTERVAL:
    'No pair of full fills can be used yet. Partial fills count towards the next full one, and a missed fill breaks the chain.',
}

const SKIP_REASON: Record<string, string> = {
  MISSED_FILL: 'a fill was missed',
  NO_DISTANCE: 'no distance between the readings',
  MIXED_ENERGY: 'fuel and charging in the same interval',
  NO_QUANTITY: 'no quantity recorded',
}

/**
 * OWN-006 — fuel and charging for one vehicle.
 *
 * Every consumption figure here is computed by the server from full fill to full fill.
 * The component does no arithmetic of its own: a number worked out in the browser could
 * disagree with the one in a report, and the rule behind it is subtle enough that having
 * it in two places would guarantee they drift (DECISIONS.md D-002).
 */
export function FuelPanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const [addOpen, setAddOpen] = useState(false)
  const mayWrite = can(workspace.role, 'fuel:write')

  const entries = useQuery({
    queryKey: ['fuel', workspace.id, vehicleId],
    queryFn: () => api.fuel.list(workspace.id, vehicleId),
  })
  const economy = useQuery({
    queryKey: ['fuel-economy', workspace.id, vehicleId],
    queryFn: () => api.fuel.economy(workspace.id, vehicleId),
  })
  /**
   * Separate from the economy query on purpose: the trend is a nice-to-have, and a panel
   * that refuses to render its fill history because a chart failed would be a poor trade.
   */
  const trend = useQuery({
    queryKey: ['fuel-trend', workspace.id, vehicleId],
    queryFn: () => api.fuel.trend(workspace.id, vehicleId),
  })

  // Checked as one condition for the reader, but narrowed on the data itself: a combined
  // isPending check does not narrow both queries for TypeScript.
  if (!entries.data || !economy.data) {
    if (entries.error || economy.error) {
      const failure = entries.error ?? economy.error
      return (
        <Card>
          <ErrorState
            message={failure instanceof ApiError ? failure.message : 'Could not load fuel records.'}
            onRetry={() => {
              void entries.refetch()
              void economy.refetch()
            }}
          />
        </Card>
      )
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-content-secondary">
          Every fill, and what the vehicle actually returns between full tanks.
        </p>
        {mayWrite && <Button onClick={() => setAddOpen(true)}>Record a fill</Button>}
      </div>

      <EconomyCard economy={economy.data} />

      {trend.data && <FuelTrendCard trend={trend.data} />}

      <Card className="mt-6">
        <CardHeader title="Fill history" description="Newest first, ordered by mileage." />
        {entries.data.length === 0 ? (
          <EmptyState
            title="No fills recorded"
            description={
              mayWrite
                ? 'Record a fill each time you fuel up or charge. Two full tanks are enough to work out consumption.'
                : 'Nothing has been recorded for this vehicle.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {entries.data.map((e) => (
              <FillRow key={e.id} entry={e} vehicleId={vehicleId} mayWrite={mayWrite} />
            ))}
          </ul>
        )}
      </Card>

      <AddFillDialog open={addOpen} onClose={() => setAddOpen(false)} vehicleId={vehicleId} />
    </>
  )
}

function EconomyCard({ economy }: { economy: FuelEconomy }) {
  const avg = economy.average

  if (!avg) {
    return (
      <Card>
        <CardBody className="py-5">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
            Consumption
          </p>
          <p className="mt-2 text-[13.5px] text-content-secondary">
            {UNAVAILABLE[economy.unavailableReason ?? 'NO_FILLS']}
          </p>
          {economy.skipped.length > 0 && (
            <p className="mt-2 text-[12.5px] text-content-tertiary">
              {economy.skipped.length} interval
              {economy.skipped.length === 1 ? '' : 's'} could not be used:{' '}
              {[...new Set(economy.skipped.map((s) => SKIP_REASON[s.reason] ?? s.reason))].join(
                ', ',
              )}
              .
            </p>
          )}
        </CardBody>
      </Card>
    )
  }

  const primary = avg.electric
    ? { value: avg.kwhPer100Km, unit: 'kWh/100 km' }
    : { value: avg.litresPer100Km, unit: 'L/100 km' }
  const secondary = avg.electric
    ? { value: avg.milesPerKwh, unit: 'mi/kWh' }
    : { value: avg.milesPerImperialGallon, unit: 'mpg' }

  return (
    <Card>
      <CardBody className="py-5">
        <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">
          Consumption
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <p className="tabular text-3xl font-semibold leading-none tracking-tight">
            {primary.value}
            <span className="ml-1.5 text-[14px] font-normal text-content-secondary">
              {primary.unit}
            </span>
          </p>
          <p className="tabular text-[15px] text-content-secondary">
            {secondary.value} {secondary.unit}
          </p>
        </div>
        <p className="mt-2.5 text-[12.5px] text-content-secondary">
          Measured over {Math.round(avg.distanceMetres / 1000).toLocaleString()} km and{' '}
          {avg.quantity} {avg.electric ? 'kWh' : 'litres'}, across {economy.intervals.length} full
          tank{economy.intervals.length === 1 ? '' : 's'}.
        </p>
        {economy.skipped.length > 0 && (
          <p className="mt-1 text-[12px] text-content-tertiary">
            {economy.skipped.length} interval{economy.skipped.length === 1 ? '' : 's'} excluded:{' '}
            {[...new Set(economy.skipped.map((s) => SKIP_REASON[s.reason] ?? s.reason))].join(', ')}
            .
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function FillRow({
  entry,
  vehicleId,
  mayWrite,
}: {
  entry: FuelEntry
  vehicleId: string
  mayWrite: boolean
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.fuel.remove(workspace.id, entry.id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fuel', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['fuel-economy', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['fuel-trend', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
      ]),
  })

  const unit = UNIT_LABEL[entry.quantityUnit] ?? entry.quantityUnit
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">
          {entry.quantity} {unit}
          {entry.stationName && (
            <span className="font-normal text-content-secondary"> · {entry.stationName}</span>
          )}
        </p>
        <p className="truncate text-[12.5px] text-content-secondary">
          {entry.odometer.toLocaleString()} {entry.odometerUnit === 'MILES' ? 'mi' : 'km'} ·{' '}
          {formatDate(entry.filledOn)}
        </p>
      </div>
      {!entry.isFullTank && <Badge className="shrink-0">Partial</Badge>}
      {entry.missedFill && (
        <span
          className="shrink-0 rounded bg-status-attention-subtle px-1.5 py-0.5 text-[11px] font-medium text-status-attention"
          title="A fill was missed before this one, so the interval cannot be measured"
        >
          Chain broken
        </span>
      )}
      <p className="tabular shrink-0 text-[13px] font-medium">
        {formatMoney(entry.totalAmount, entry.currency)}
      </p>
      {mayWrite && (
        <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
          Remove
        </Button>
      )}
    </li>
  )
}

function AddFillDialog({
  open,
  onClose,
  vehicleId,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isFullTank, setIsFullTank] = useState(true)

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.fuel.create(workspace.id, vehicleId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fuel', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['fuel-economy', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['fuel-trend', workspace.id, vehicleId] }),
        // A fill is a mileage reading and a cost, so both of those views are now stale.
        queryClient.invalidateQueries({ queryKey: ['odometer', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['odometer-current', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['expenses', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setError(Object.keys(err.fieldErrors).length ? null : err.message)
      } else {
        setError('Could not save the fill. Please try again.')
      }
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const fd = new FormData(e.currentTarget)
    const str = (k: string) => String(fd.get(k) ?? '').trim()

    create.mutate({
      filledOn: str('filledOn'),
      odometer: Number(str('odometer')),
      quantity: Number(str('quantity')),
      quantityUnit: str('quantityUnit') || 'LITRES',
      currency: str('currency') || workspace.defaultCurrency,
      isFullTank,
      missedFill: isFullTank && fd.get('missedFill') === 'on',
      ...(str('totalAmount') ? { totalAmount: str('totalAmount') } : {}),
      ...(str('stationName') ? { stationName: str('stationName') } : {}),
      ...(str('notes') ? { notes: str('notes') } : {}),
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Record a fill" size="md">
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
          >
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="filledOn"
            label="Date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            error={fieldErrors.filledOn}
          />
          <TextField
            name="odometer"
            label="Mileage"
            type="number"
            inputMode="numeric"
            required
            hint="Added to the vehicle's mileage history"
            error={fieldErrors.odometer}
          />
          <TextField
            name="quantity"
            label="Amount"
            type="number"
            step="0.001"
            inputMode="decimal"
            required
            placeholder="45.5"
            error={fieldErrors.quantity}
          />
          <SelectField name="quantityUnit" label="Unit" defaultValue="LITRES">
            <option value="LITRES">Litres</option>
            <option value="IMP_GALLONS">Imperial gallons</option>
            <option value="US_GALLONS">US gallons</option>
            <option value="KWH">kWh (electric)</option>
          </SelectField>
          <TextField
            name="totalAmount"
            label="Total paid"
            inputMode="decimal"
            placeholder="68.20"
            error={fieldErrors.totalAmount}
          />
          <TextField name="stationName" label="Where" placeholder="Shell, M4 services" />
        </div>

        <div className="mt-5 rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-3">
          <label className="flex items-start gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={isFullTank}
              onChange={(e) => setIsFullTank(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Filled the tank completely</span>
              <span className="mt-0.5 block text-[12.5px] text-content-secondary">
                Consumption can only be worked out between two full tanks. A partial fill still
                counts — it is added to the next full one.
              </span>
            </span>
          </label>

          {isFullTank && (
            <label className="mt-3 flex items-start gap-2.5 border-t border-border-subtle pt-3 text-[13px]">
              <input type="checkbox" name="missedFill" className="mt-0.5" />
              <span>
                <span className="font-medium">I missed recording a fill before this one</span>
                <span className="mt-0.5 block text-[12.5px] text-content-secondary">
                  This interval will be left out rather than reported as unusually thirsty.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="mt-4">
          <TextAreaField name="notes" label="Notes" />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
