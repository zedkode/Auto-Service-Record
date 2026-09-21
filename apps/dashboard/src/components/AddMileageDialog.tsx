import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, SelectField, TextField, TextAreaField } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import type { DistanceUnit } from '@autoservices/types'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

/**
 * Adding mileage creates a NEW odometer entry. It never overwrites history
 * (task brief §26, DECISIONS.md D-001).
 *
 * A reading lower than the last one is rejected by the server with ODOMETER_REGRESSION;
 * the user can then explicitly record it as a correction, which is audited.
 */
export function AddMileageDialog({
  open,
  onClose,
  vehicleId,
  defaultUnit,
  currentValue,
}: {
  open: boolean
  onClose: () => void
  vehicleId: string
  defaultUnit: DistanceUnit
  currentValue: number | null
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)

  const [error, setError] = useState<string | null>(null)
  const [needsCorrection, setNeedsCorrection] = useState(false)

  // Reset when the dialog is opened. Adjusting state during render is React's documented
  // pattern for "state derived from a prop change"; doing it in an effect would schedule
  // a second render pass every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setError(null)
      setNeedsCorrection(false)
    }
  }

  const add = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.vehicles.addOdometer(workspace.id, vehicleId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['odometer', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['odometer-current', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['timeline', workspace.id, vehicleId] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles', workspace.id] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      ])
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message)
        // Offer the correction path only when the server says this is a regression.
        if (err.code === 'ODOMETER_REGRESSION') setNeedsCorrection(true)
      } else {
        setError('Could not save the reading. Please try again.')
      }
    },
  })

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const value = Number(fd.get('value'))
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid mileage reading.')
      return
    }
    const reason = String(fd.get('correctionReason') ?? '').trim()
    add.mutate({
      value,
      unit: String(fd.get('unit')) as DistanceUnit,
      recordedOn: String(fd.get('recordedOn')),
      notes: String(fd.get('notes') ?? '').trim() || undefined,
      allowRegression: needsCorrection,
      correctionReason: needsCorrection ? reason : undefined,
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a mileage reading"
      description={
        currentValue !== null
          ? `Last recorded: ${new Intl.NumberFormat('en-GB').format(currentValue)} ${defaultUnit === 'MILES' ? 'mi' : 'km'}`
          : 'This will be the first reading for this vehicle.'
      }
    >
      <form id="add-mileage-form" onSubmit={onSubmit} noValidate>
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
            name="value"
            label="Mileage"
            type="number"
            inputMode="numeric"
            required
            autoFocus
            placeholder={currentValue !== null ? String(currentValue + 500) : '120000'}
          />
          <SelectField name="unit" label="Units" defaultValue={defaultUnit}>
            <option value="MILES">Miles</option>
            <option value="KILOMETERS">Kilometres</option>
          </SelectField>
          <TextField
            name="recordedOn"
            label="Date"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="sm:col-span-2"
          />
          <TextAreaField
            name="notes"
            label="Notes"
            placeholder="Optional"
            className="sm:col-span-2"
          />
        </div>

        {needsCorrection && (
          <div className="mt-4 rounded-md border border-status-due-soon/30 bg-status-due-soon-subtle p-3">
            <p className="mb-2 text-[12.5px] font-medium text-status-due-soon">
              To record a lower reading, explain why. It will be saved as a correction and kept in
              the audit history.
            </p>
            <TextAreaField
              name="correctionReason"
              label="Reason for the correction"
              required
              placeholder="e.g. Previous reading was entered with an extra digit"
            />
          </div>
        )}
      </form>

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="add-mileage-form" variant="primary" loading={add.isPending}>
          {needsCorrection ? 'Save correction' : 'Save reading'}
        </Button>
      </div>
    </Dialog>
  )
}
