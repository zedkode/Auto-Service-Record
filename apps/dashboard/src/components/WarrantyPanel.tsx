/**
 * OWN-004 — warranties, which end on a date OR a mileage.
 *
 * The two clocks are why this is not another `SummaryCard`. "Covered until March 2028" is
 * a half-truth on a car doing 25,000 miles a year against a 60,000-mile limit, and the
 * mileage is the number the owner can check against the dial in front of them.
 *
 * Every state, remaining figure and caveat is computed by the API against the vehicle's
 * current reading. This renders them.
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
  TextAreaField,
  TextField,
  formatDate,
} from '@autoservices/ui'
import { ApiError, type Warranty } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

const TYPE_LABEL: Record<Warranty['warrantyType'], string> = {
  MANUFACTURER: 'Manufacturer',
  DEALER: 'Dealer',
  THIRD_PARTY: 'Third party',
  PART: 'Part',
  REPAIR: 'Repair',
}

const STATE_LABEL: Record<Warranty['status']['state'], string> = {
  ACTIVE: 'In cover',
  EXPIRING_SOON: 'Ending soon',
  EXPIRED: 'Ended',
  NOT_STARTED: 'Not started',
  UNKNOWN: 'No end recorded',
}

const STATE_CLASS: Record<Warranty['status']['state'], string> = {
  ACTIVE: 'border-transparent bg-status-healthy-subtle text-status-healthy',
  EXPIRING_SOON: 'border-transparent bg-status-due-soon-subtle text-status-due-soon',
  EXPIRED: 'border-transparent bg-status-overdue-subtle text-status-overdue',
  NOT_STARTED: '',
  UNKNOWN: '',
}

const CAUTION: Record<string, string> = {
  NO_ODOMETER:
    'This warranty has a mileage limit but the vehicle has no reading recorded, so only the date could be checked.',
  NO_START_ODOMETER:
    'This warranty is measured from when the work was done, but no starting mileage was recorded — the limit is being read as a total odometer figure instead.',
}

const unitLabel = (u: string | null) => (u === 'KILOMETERS' ? 'km' : 'miles')

/** The sentence under the heading: what is left, on whichever clock runs out first. */
function coverLine(w: Warranty): string {
  const s = w.status
  if (s.state === 'NOT_STARTED') return `Starts ${formatDate(w.startsOn ?? '')}`
  if (s.state === 'UNKNOWN') return 'No expiry date or mileage limit recorded'

  const parts: string[] = []
  if (s.daysRemaining !== null && w.expiresOn) {
    parts.push(
      s.daysRemaining < 0
        ? `expired ${Math.abs(s.daysRemaining)} days ago`
        : `${s.daysRemaining} days left`,
    )
  }
  if (s.distanceRemaining !== null) {
    const n = Math.abs(s.distanceRemaining).toLocaleString()
    parts.push(
      s.distanceRemaining < 0
        ? `${n} ${unitLabel(w.distanceLimitUnit)} over the limit`
        : `${n} ${unitLabel(w.distanceLimitUnit)} left`,
    )
  }
  if (parts.length === 0) return ''
  // Two clocks joined by "or" rather than "and": whichever arrives first ends the cover.
  return parts.join(' or ')
}

export function WarrantyPanel({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useSession()
  const mayWrite = can(workspace.role, 'ownership:write')
  const [open, setOpen] = useState(false)

  const warranties = useQuery({
    queryKey: ['warranties', workspace.id, vehicleId],
    queryFn: () => api.warranties.list(workspace.id, vehicleId),
  })

  const rows = warranties.data ?? []

  return (
    <>
      <Card className="mt-6">
        <CardHeader
          title="Warranties"
          description="A warranty ends on its date or its mileage — whichever comes first."
          action={
            mayWrite ? (
              <Button variant="secondary" onClick={() => setOpen(true)}>
                Add a warranty
              </Button>
            ) : undefined
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            title="No warranties recorded"
            description={
              mayWrite
                ? 'Add the manufacturer warranty, or a guarantee on a part or repair, and its mileage limit will be tracked against your readings.'
                : 'Nothing has been recorded for this vehicle.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {rows.map((w) => (
              <li key={w.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <Badge className={STATE_CLASS[w.status.state]}>
                    {STATE_LABEL[w.status.state]}
                  </Badge>
                  <span className="text-[13px] font-medium">
                    {TYPE_LABEL[w.warrantyType]}
                    {w.providerName && ` · ${w.providerName}`}
                  </span>
                  {w.status.governedBy === 'DISTANCE' && (
                    <span className="text-[11.5px] uppercase tracking-wide text-content-tertiary">
                      on mileage
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-content-secondary">{coverLine(w)}</p>
                <p className="mt-0.5 text-[12px] text-content-tertiary">
                  {w.expiresOn ? `Until ${formatDate(w.expiresOn)}` : 'No end date'}
                  {w.distanceLimit !== null &&
                    ` · ${w.distanceLimit.toLocaleString()} ${unitLabel(w.distanceLimitUnit)} limit`}
                  {w.startOdometer !== null &&
                    ` from ${w.startOdometer.toLocaleString()} ${unitLabel(w.startOdometerUnit)}`}
                </p>
                {w.status.cautions.map((c) => (
                  <p key={c} className="mt-1 text-[12px] text-status-due-soon">
                    {CAUTION[c]}
                  </p>
                ))}
                {w.coverageNotes && (
                  <p className="mt-1 text-[12.5px] text-content-secondary">{w.coverageNotes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AddWarrantyDialog open={open} onClose={() => setOpen(false)} vehicleId={vehicleId} />
    </>
  )
}

function AddWarrantyDialog({
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
  const [type, setType] = useState<Warranty['warrantyType']>('MANUFACTURER')

  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.warranties.create(workspace.id, vehicleId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['warranties', workspace.id, vehicleId] }),
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

  // Only work-based warranties are measured from a starting reading, so the field is
  // offered only where it means something.
  const measuredFromFitting = type === 'PART' || type === 'REPAIR'

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const raw: Record<string, string> = {}
    for (const [k, v] of fd.entries()) {
      const value = typeof v === 'string' ? v.trim() : ''
      if (value) raw[k] = value
    }
    mutation.mutate({
      warrantyType: raw.warrantyType,
      startsOn: raw.startsOn,
      ...(raw.expiresOn ? { expiresOn: raw.expiresOn } : {}),
      ...(raw.providerName ? { providerName: raw.providerName } : {}),
      ...(raw.reference ? { reference: raw.reference } : {}),
      ...(raw.distanceLimit
        ? {
            distanceLimit: Number(raw.distanceLimit),
            distanceLimitUnit: raw.distanceLimitUnit ?? 'MILES',
          }
        : {}),
      ...(raw.startOdometer
        ? {
            startOdometer: Number(raw.startOdometer),
            startOdometerUnit: raw.startOdometerUnit ?? 'MILES',
          }
        : {}),
      ...(raw.coverageNotes ? { coverageNotes: raw.coverageNotes } : {}),
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a warranty" size="md">
      <form onSubmit={submit}>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
          >
            {error}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="warrantyType"
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as Warranty['warrantyType'])}
            error={fieldErrors.warrantyType}
          >
            <option value="MANUFACTURER">Manufacturer</option>
            <option value="DEALER">Dealer</option>
            <option value="THIRD_PARTY">Third party</option>
            <option value="PART">Part</option>
            <option value="REPAIR">Repair</option>
          </SelectField>
          <TextField name="providerName" label="Provider" placeholder="Ford" />
          <TextField
            name="startsOn"
            label="Starts on"
            type="date"
            required
            error={fieldErrors.startsOn}
          />
          <TextField
            name="expiresOn"
            label="Ends on"
            type="date"
            hint="Leave blank if it is mileage-only"
            error={fieldErrors.expiresOn}
          />
          <TextField
            name="distanceLimit"
            label="Mileage limit"
            type="number"
            inputMode="numeric"
            hint={
              measuredFromFitting
                ? 'Distance covered since the work was done'
                : 'The odometer reading at which cover ends'
            }
            error={fieldErrors.distanceLimit}
          />
          <SelectField name="distanceLimitUnit" label="Limit unit" defaultValue="MILES">
            <option value="MILES">Miles</option>
            <option value="KILOMETERS">Kilometres</option>
          </SelectField>
          {measuredFromFitting && (
            <>
              <TextField
                name="startOdometer"
                label="Mileage when fitted"
                type="number"
                inputMode="numeric"
                hint="So the allowance is counted from here"
                error={fieldErrors.startOdometer}
              />
              <SelectField name="startOdometerUnit" label="Reading unit" defaultValue="MILES">
                <option value="MILES">Miles</option>
                <option value="KILOMETERS">Kilometres</option>
              </SelectField>
            </>
          )}
        </div>
        <TextAreaField name="coverageNotes" label="What it covers" className="mt-4" rows={2} />
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
