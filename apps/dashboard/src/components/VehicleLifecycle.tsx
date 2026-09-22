import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import { Button, Dialog, SelectField, TextField } from '@autoservices/ui'
import { ApiError } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'In use',
  STORED: 'Stored',
  SOLD: 'Sold',
  SCRAPPED: 'Scrapped',
  ARCHIVED: 'Archived',
}

const STATUS_HELP: Record<string, string> = {
  ACTIVE: 'Driven normally. Reminders and servicing stay active.',
  STORED: 'Off the road for now. Reminders stop; nothing is lost.',
  SOLD: 'No longer yours. The full history stays here for your records.',
  SCRAPPED: 'Written off or scrapped. The history stays here.',
  ARCHIVED: 'Kept for reference only.',
}

/**
 * VEH-003 — moving a vehicle through its life, and removing one entered in error.
 *
 * The distinction the UI has to make clear is the one users get wrong: selling a car is
 * not deleting it. Selling keeps everything; deleting hides a mistake and is reversible.
 * Neither destroys the history (DATABASE.md §5).
 */
export function VehicleLifecycle({
  vehicleId,
  status,
  vehicleName,
}: {
  vehicleId: string
  status: string
  vehicleName: string
}) {
  const { workspace } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [statusOpen, setStatusOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mayUpdate = can(workspace.role, 'vehicle:update')
  const mayDelete = can(workspace.role, 'vehicle:delete')

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicle', workspace.id, vehicleId] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['reminders', workspace.id] }),
    ])

  const changeStatus = useMutation({
    mutationFn: ({ next, reason }: { next: string; reason?: string }) =>
      api.vehicles.changeStatus(workspace.id, vehicleId, next, reason),
    onSuccess: async () => {
      setStatusOpen(false)
      setError(null)
      await refresh()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not change the status.'),
  })

  const remove = useMutation({
    mutationFn: () => api.vehicles.remove(workspace.id, vehicleId),
    onSuccess: async () => {
      await refresh()
      navigate('/vehicles')
    },
    onError: (err) => {
      setDeleteOpen(false)
      setError(err instanceof ApiError ? err.message : 'Could not remove the vehicle.')
    },
  })

  // After the hooks, never before: a conditional early return changes the hook order if
  // the viewer's role changes within a session.
  if (!mayUpdate && !mayDelete) return null

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-status-overdue/30 bg-status-overdue-subtle px-3 py-2 text-[13px] text-status-overdue"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {mayUpdate && (
          <Button variant="secondary" onClick={() => setStatusOpen(true)}>
            Change status
          </Button>
        )}
        {mayDelete && (
          <Button variant="ghost" onClick={() => setDeleteOpen(true)}>
            Remove
          </Button>
        )}
      </div>

      <Dialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change status"
        size="sm"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            changeStatus.mutate({
              next: String(fd.get('status') ?? 'ACTIVE'),
              reason: String(fd.get('reason') ?? '').trim() || undefined,
            })
          }}
          noValidate
        >
          <div className="space-y-4">
            <SelectField name="status" label="Status" defaultValue={status}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <TextField
              name="reason"
              label="Reason"
              placeholder="Sold to a dealer"
              hint="Kept on the record so you know why, later"
            />
          </div>
          <p className="mt-4 rounded-md border border-border-subtle bg-surface-sunken/40 px-3 py-2 text-[12.5px] text-content-secondary">
            {STATUS_HELP[status] ?? ''} Whatever you choose, <strong>nothing is deleted</strong> —
            every service, fill and document stays with the vehicle.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setStatusOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={changeStatus.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Remove this vehicle?"
        size="sm"
      >
        <p className="text-[13.5px]">
          <strong>{vehicleName}</strong> will be hidden, along with its costs.
        </p>
        <p className="mt-2 text-[13px] text-content-secondary">
          Nothing is destroyed: the history is kept and you can restore the vehicle from the
          vehicles list. If you sold it, use <strong>Change status</strong> instead — that keeps it
          visible in your records.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        </div>
      </Dialog>
    </>
  )
}
