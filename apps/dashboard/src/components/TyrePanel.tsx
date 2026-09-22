/**
 * OWN-005 — tyre sets.
 *
 * Two things carry the value here and neither is a form: how far a set has actually run
 * across every winter it has been on, and what its tread measured. Both are computed by
 * the API against the vehicle's current mileage; this renders them and nothing else.
 */
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  SelectField,
  TextField,
  formatDate,
} from '@autoservices/ui'
import { ApiError, type TyreSet } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

const SEASON: Record<TyreSet['season'], string> = {
  SUMMER: 'Summer',
  WINTER: 'Winter',
  ALL_SEASON: 'All-season',
}

const TREAD_LABEL: Record<TyreSet['tread']['state'], string> = {
  GOOD: 'Tread good',
  MONITOR: 'Watch the tread',
  REPLACE_SOON: 'Replace soon',
  ILLEGAL: 'Below the legal minimum',
  UNKNOWN: 'Tread not measured',
}

const TREAD_CLASS: Record<TyreSet['tread']['state'], string> = {
  GOOD: 'border-transparent bg-status-healthy-subtle text-status-healthy',
  MONITOR: '',
  REPLACE_SOON: 'border-transparent bg-status-due-soon-subtle text-status-due-soon',
  ILLEGAL: 'border-transparent bg-status-overdue-subtle text-status-overdue',
  UNKNOWN: '',
}

const NO_DISTANCE: Record<string, string> = {
  NEVER_FITTED: 'Never fitted',
  NO_INSTALL_READING: 'No mileage recorded when fitted',
  NO_CURRENT_READING: 'Add a mileage reading to measure this',
}

function distanceLine(set: TyreSet): string {
  const d = set.distance
  if (d.miles === null) return NO_DISTANCE[d.unavailableReason ?? 'NEVER_FITTED'] ?? '—'
  const base = `${d.miles.toLocaleString()} miles on this set`
  // A total from three of five periods is not the total, and the page says so.
  return d.unmeasuredPeriods > 0
    ? `${base}, over ${d.measuredPeriods} of ${d.measuredPeriods + d.unmeasuredPeriods} fittings`
    : base
}

export function TyrePanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const mayWrite = can(workspace.role, 'ownership:write')
  const [dialog, setDialog] = useState<
    null | { mode: 'add' } | { mode: 'fit' | 'off' | 'tread'; set: TyreSet }
  >(null)

  const sets = useQuery({
    queryKey: ['tyre-sets', workspace.id, vehicleId],
    queryFn: () => api.tyres.list(workspace.id, vehicleId),
  })

  const rows = sets.data ?? []
  const fitted = rows.find((s) => s.fitted) ?? null

  return (
    <>
      <Card className="mt-6">
        <CardHeader
          title="Tyres"
          description={
            fitted
              ? `${fitted.name} is on the car. Fitting another set takes this one off.`
              : 'Nothing is recorded as fitted.'
          }
          action={
            mayWrite ? (
              <Button variant="secondary" onClick={() => setDialog({ mode: 'add' })}>
                Add a set
              </Button>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            title="No tyre sets recorded"
            description={
              mayWrite
                ? 'Add a set to track how far it has run and what its tread measured — across every winter it goes back on.'
                : 'Nothing has been recorded for this vehicle.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {rows.map((set) => (
              <li key={set.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {set.fitted && (
                    <Badge className="border-transparent bg-accent-subtle text-accent">
                      On the car
                    </Badge>
                  )}
                  <span className="text-[13px] font-medium">{set.name}</span>
                  <span className="text-[12px] text-content-tertiary">
                    {SEASON[set.season]}
                    {set.size && ` · ${set.size}`}
                    {set.manufacturer && ` · ${set.manufacturer}`}
                  </span>
                  {set.tread.state !== 'UNKNOWN' && (
                    <Badge className={TREAD_CLASS[set.tread.state]}>
                      {set.tread.depthMm} mm — {TREAD_LABEL[set.tread.state]}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-content-secondary">{distanceLine(set)}</p>
                {set.tread.stale && set.tread.measuredOn && (
                  <p className="mt-0.5 text-[12px] text-status-due-soon">
                    Last measured {formatDate(set.tread.measuredOn)} — worth checking again.
                  </p>
                )}
                {mayWrite && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {set.fitted ? (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialog({ mode: 'tread', set })}
                        >
                          Record tread
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialog({ mode: 'off', set })}
                        >
                          Take off
                        </Button>
                      </>
                    ) : (
                      set.status !== 'RETIRED' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialog({ mode: 'fit', set })}
                        >
                          Fit to vehicle
                        </Button>
                      )
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TyreDialog
        state={dialog}
        vehicleId={vehicleId}
        fittedName={fitted?.name ?? null}
        onClose={() => setDialog(null)}
      />
    </>
  )
}

type DialogState = null | { mode: 'add' } | { mode: 'fit' | 'off' | 'tread'; set: TyreSet }

function TyreDialog({
  state,
  vehicleId,
  fittedName,
  onClose,
}: {
  state: DialogState
  vehicleId: string
  fittedName: string | null
  onClose: () => void
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => {
      if (!state) throw new Error('no dialog')
      if (state.mode === 'add') return api.tyres.create(workspace.id, vehicleId, input)
      if (state.mode === 'fit') return api.tyres.fit(workspace.id, state.set.id, input)
      if (state.mode === 'off')
        return api.tyres.removeFromVehicle(workspace.id, state.set.id, input)
      return api.tyres.measureTread(workspace.id, state.set.id, input)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tyre-sets', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['reminders', workspace.id] }),
      ])
      setError(null)
      setFieldErrors({})
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setError(Object.keys(err.fieldErrors).length ? null : err.message)
      } else {
        setError('Could not save. Please try again.')
      }
    },
  })

  if (!state) return null

  const today = new Date().toISOString().slice(0, 10)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const raw: Record<string, string> = {}
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : ''
      if (value) raw[k] = value
    }
    if (state.mode === 'add') {
      mutation.mutate({
        name: raw.name,
        season: raw.season,
        ...(raw.manufacturer ? { manufacturer: raw.manufacturer } : {}),
        ...(raw.size ? { size: raw.size } : {}),
        ...(raw.purchasePrice ? { purchasePrice: raw.purchasePrice } : {}),
      })
    } else if (state.mode === 'fit') {
      mutation.mutate({
        installedOn: raw.installedOn,
        odometerUnit: raw.odometerUnit ?? 'MILES',
        ...(raw.installedOdometer ? { installedOdometer: Number(raw.installedOdometer) } : {}),
        ...(raw.treadDepthMm ? { treadDepthMm: Number(raw.treadDepthMm) } : {}),
      })
    } else if (state.mode === 'off') {
      mutation.mutate({
        removedOn: raw.removedOn,
        ...(raw.removedOdometer ? { removedOdometer: Number(raw.removedOdometer) } : {}),
        ...(raw.treadDepthMm ? { treadDepthMm: Number(raw.treadDepthMm) } : {}),
      })
    } else {
      mutation.mutate({ treadDepthMm: Number(raw.treadDepthMm), measuredOn: raw.measuredOn })
    }
  }

  const title =
    state.mode === 'add'
      ? 'Add a tyre set'
      : state.mode === 'fit'
        ? `Fit ${state.set.name}`
        : state.mode === 'off'
          ? `Take ${state.set.name} off`
          : `Record tread on ${state.set.name}`

  return (
    <Dialog open onClose={onClose} title={title} size="md">
      <form onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
          >
            {error}
          </div>
        )}

        {state.mode === 'fit' && fittedName && (
          // Said before the action, not after: the swap is the point, but it should not be
          // a surprise.
          <p className="mb-4 text-[13px] text-content-secondary">
            {fittedName} is on the car and will be recorded as taken off at this date and mileage.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {state.mode === 'add' && (
            <>
              <TextField
                name="name"
                label="Name"
                placeholder="Winter set"
                required
                error={fieldErrors.name}
              />
              <SelectField name="season" label="Season" defaultValue="SUMMER">
                <option value="SUMMER">Summer</option>
                <option value="WINTER">Winter</option>
                <option value="ALL_SEASON">All-season</option>
              </SelectField>
              <TextField name="manufacturer" label="Make" placeholder="Michelin" />
              <TextField name="size" label="Size" placeholder="225/45 R17" />
              <TextField name="purchasePrice" label="What they cost" placeholder="480.00" />
            </>
          )}

          {state.mode === 'fit' && (
            <>
              <TextField
                name="installedOn"
                label="Fitted on"
                type="date"
                defaultValue={today}
                required
                error={fieldErrors.installedOn}
              />
              <TextField
                name="installedOdometer"
                label="Mileage when fitted"
                type="number"
                inputMode="numeric"
                hint="Needed to measure how far the set runs"
                error={fieldErrors.installedOdometer}
              />
              <SelectField name="odometerUnit" label="Unit" defaultValue="MILES">
                <option value="MILES">Miles</option>
                <option value="KILOMETERS">Kilometres</option>
              </SelectField>
              <TextField
                name="treadDepthMm"
                label="Tread now (mm)"
                type="number"
                step="0.1"
                error={fieldErrors.treadDepthMm}
              />
            </>
          )}

          {state.mode === 'off' && (
            <>
              <TextField
                name="removedOn"
                label="Taken off on"
                type="date"
                defaultValue={today}
                required
                error={fieldErrors.removedOn}
              />
              <TextField
                name="removedOdometer"
                label="Mileage when taken off"
                type="number"
                inputMode="numeric"
                error={fieldErrors.removedOdometer}
              />
              <TextField
                name="treadDepthMm"
                label="Tread now (mm)"
                type="number"
                step="0.1"
                error={fieldErrors.treadDepthMm}
              />
            </>
          )}

          {state.mode === 'tread' && (
            <>
              <TextField
                name="treadDepthMm"
                label="Tread depth (mm)"
                type="number"
                step="0.1"
                required
                hint="1.6 mm is the legal minimum; replacement is advised below 3 mm"
                error={fieldErrors.treadDepthMm}
              />
              <TextField
                name="measuredOn"
                label="Measured on"
                type="date"
                defaultValue={today}
                required
                error={fieldErrors.measuredOn}
              />
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
