import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  TextField,
  formatDate,
  formatDistance,
} from '@autoservices/ui'
import { ApiError, type MaintenanceRule } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { MAINTENANCE_TONE as TONE } from '../lib/maintenance-status.js'

export function MaintenancePanel({
  vehicleId,
  distanceUnit,
}: {
  vehicleId: string
  distanceUnit: 'MILES' | 'KILOMETERS'
}) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [completing, setCompleting] = useState<MaintenanceRule | null>(null)
  const [editing, setEditing] = useState<MaintenanceRule | null>(null)

  const rules = useQuery({
    queryKey: ['maintenance', workspace.id, vehicleId],
    queryFn: () => api.maintenance.listForVehicle(workspace.id, vehicleId),
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maintenance', workspace.id, vehicleId] }),
      queryClient.invalidateQueries({ queryKey: ['maintenance-due', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles', workspace.id] }),
    ])

  const applyTemplate = useMutation({
    mutationFn: () => api.maintenance.applyTemplate(workspace.id, vehicleId),
    onSuccess: refresh,
  })

  if (rules.isPending) {
    return (
      <Card>
        <CardHeader title="Maintenance schedule" />
        <CardBody className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardBody>
      </Card>
    )
  }

  if (rules.error) {
    return (
      <Card>
        <ErrorState
          message={
            rules.error instanceof ApiError ? rules.error.message : 'Could not load the schedule.'
          }
          requestId={rules.error instanceof ApiError ? rules.error.requestId : undefined}
          onRetry={() => void rules.refetch()}
        />
      </Card>
    )
  }

  if (rules.data.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No maintenance schedule configured"
          description="Add maintenance items to get automatic due dates and reminders. You can start from our suggested intervals and change any of them."
          action={
            <Button
              variant="primary"
              loading={applyTemplate.isPending}
              onClick={() => applyTemplate.mutate()}
            >
              Start from suggested intervals
            </Button>
          }
        />
      </Card>
    )
  }

  const active = rules.data.filter((r) => r.isActive)
  const needsAttention = active.filter((r) => r.status !== 'OK')

  return (
    <>
      <Card>
        <CardHeader
          title="Maintenance schedule"
          description={
            needsAttention.length === 0
              ? 'Everything is up to date.'
              : needsAttention.length === 1
                ? '1 item needs attention.'
                : `${needsAttention.length} items need attention.`
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={applyTemplate.isPending}
              onClick={() => applyTemplate.mutate()}
            >
              Add missing items
            </Button>
          }
        />
        <CardBody className="px-0 pb-0">
          <p className="px-5 pb-3 text-[12px] text-content-tertiary">
            Suggested intervals are common practice, not manufacturer specifications. Check your
            handbook and adjust anything that differs.
          </p>
          <ul className="divide-y divide-border-subtle border-t border-border-subtle">
            {active.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13.5px] font-medium">{rule.name}</span>
                    <StatusBadge status={TONE[rule.status]} label={rule.summary} />
                    {rule.odometerConfidence === 'STALE' && (
                      <span className="rounded border border-border-default px-1.5 py-px text-[11px] text-content-tertiary">
                        mileage stale
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-content-secondary">
                    {intervalLabel(rule)}
                    {rule.lastCompletedOn && ` · last done ${formatDate(rule.lastCompletedOn)}`}
                    {rule.nextDueOdometer !== null &&
                      ` · next at ${formatDistance(rule.nextDueOdometer, rule.nextDueOdometerUnit ?? distanceUnit)}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setCompleting(rule)}>
                    Mark done
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                    Edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <CompleteDialog
        rule={completing}
        onClose={() => setCompleting(null)}
        distanceUnit={distanceUnit}
        onDone={refresh}
      />
      <EditIntervalDialog rule={editing} onClose={() => setEditing(null)} onDone={refresh} />
    </>
  )
}

function intervalLabel(r: MaintenanceRule): string {
  const parts: string[] = []
  if (r.intervalDistance) {
    parts.push(`every ${formatDistance(r.intervalDistance, r.intervalDistanceUnit ?? 'MILES')}`)
  }
  if (r.intervalMonths) {
    parts.push(
      r.intervalMonths % 12 === 0
        ? `every ${r.intervalMonths / 12} year${r.intervalMonths === 12 ? '' : 's'}`
        : `every ${r.intervalMonths} months`,
    )
  }
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}, whichever comes first`
  return parts[0] ?? 'no interval set'
}

function CompleteDialog({
  rule,
  onClose,
  distanceUnit,
  onDone,
}: {
  rule: MaintenanceRule | null
  onClose: () => void
  distanceUnit: 'MILES' | 'KILOMETERS'
  onDone: () => Promise<unknown>
}) {
  const { workspace } = useSession()
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)

  const complete = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.maintenance.complete(workspace.id, rule!.id, input),
    onSuccess: async () => {
      await onDone()
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not record that.'),
  })

  if (!rule) return null

  return (
    <Dialog
      open={rule !== null}
      onClose={onClose}
      title={`Mark "${rule.name}" as done`}
      description="This is added to the item's history; previous completions are kept."
    >
      <form
        id="complete-form"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          const fd = new FormData(e.currentTarget)
          const odo = String(fd.get('odometer') ?? '').trim()
          complete.mutate({
            completedOn: String(fd.get('completedOn')),
            ...(odo ? { odometer: Number(odo) } : {}),
            ...(String(fd.get('notes') ?? '').trim()
              ? { notes: String(fd.get('notes')).trim() }
              : {}),
          })
        }}
        noValidate
      >
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
            name="completedOn"
            label="Date completed"
            type="date"
            required
            defaultValue={today}
            max={today}
          />
          <TextField
            name="odometer"
            label={`Mileage (${distanceUnit === 'MILES' ? 'mi' : 'km'})`}
            type="number"
            inputMode="numeric"
            hint="Used to schedule the next one"
          />
          <TextField name="notes" label="Notes" className="sm:col-span-2" />
        </div>
      </form>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="complete-form" variant="primary" loading={complete.isPending}>
          Mark as done
        </Button>
      </div>
    </Dialog>
  )
}

function EditIntervalDialog({
  rule,
  onClose,
  onDone,
}: {
  rule: MaintenanceRule | null
  onClose: () => void
  onDone: () => Promise<unknown>
}) {
  const { workspace } = useSession()
  const [error, setError] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.maintenance.update(workspace.id, rule!.id, input),
    onSuccess: async () => {
      await onDone()
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save.'),
  })

  if (!rule) return null

  return (
    <Dialog
      open={rule !== null}
      onClose={onClose}
      title={`Edit "${rule.name}"`}
      description="Your handbook beats our suggestion — set whatever the manufacturer specifies."
    >
      <form
        id="edit-interval-form"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          const fd = new FormData(e.currentTarget)
          const dist = String(fd.get('intervalDistance') ?? '').trim()
          const months = String(fd.get('intervalMonths') ?? '').trim()
          update.mutate({
            intervalDistance: dist ? Number(dist) : null,
            intervalMonths: months ? Number(months) : null,
            intervalType: dist && months ? 'COMBINED' : dist ? 'DISTANCE_BASED' : 'TIME_BASED',
          })
        }}
        noValidate
      >
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
            name="intervalDistance"
            label={`Every (${rule.intervalDistanceUnit === 'KILOMETERS' ? 'km' : 'miles'})`}
            type="number"
            inputMode="numeric"
            defaultValue={rule.intervalDistance ?? ''}
          />
          <TextField
            name="intervalMonths"
            label="Every (months)"
            type="number"
            inputMode="numeric"
            defaultValue={rule.intervalMonths ?? ''}
          />
        </div>
        <p className="mt-3 text-[12.5px] text-content-tertiary">
          Set both to have it fall due on whichever comes first. Leave one blank to use only the
          other.
        </p>
      </form>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="edit-interval-form"
          variant="primary"
          loading={update.isPending}
        >
          Save interval
        </Button>
      </div>
    </Dialog>
  )
}
