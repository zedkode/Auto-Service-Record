import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
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
import { ApiError, type Reminder } from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'
import { PageHeader } from '../components/PageHeader.js'

type Group = 'overdue' | 'dueSoon' | 'upcoming'

/** Reminders page (task brief §28): overdue, due soon, upcoming, and what was handled. */
export function RemindersPage() {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const [showHandled, setShowHandled] = useState(false)

  const reminders = useQuery({
    queryKey: ['reminders', workspace.id, showHandled],
    queryFn: () => api.reminders.list(workspace.id, showHandled ? 'all' : 'active'),
  })

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['reminders', workspace.id] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications-unread'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard', workspace.id] }),
    ])

  const snooze = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.reminders.snooze(workspace.id, id, { days }),
    onSuccess: refresh,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => api.reminders.dismiss(workspace.id, id),
    onSuccess: refresh,
  })
  const complete = useMutation({
    mutationFn: (id: string) => api.reminders.complete(workspace.id, id),
    onSuccess: refresh,
  })

  if (reminders.isPending) {
    return (
      <>
        <PageHeader title="Reminders" />
        <Card>
          <CardBody className="space-y-2 pt-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardBody>
        </Card>
      </>
    )
  }

  if (reminders.error) {
    return (
      <>
        <PageHeader title="Reminders" />
        <Card>
          <ErrorState
            message={
              reminders.error instanceof ApiError
                ? reminders.error.message
                : 'Could not load your reminders.'
            }
            requestId={reminders.error instanceof ApiError ? reminders.error.requestId : undefined}
            onRetry={() => void reminders.refetch()}
          />
        </Card>
      </>
    )
  }

  const active = reminders.data.filter((r) =>
    ['SCHEDULED', 'DUE', 'SENT', 'SNOOZED'].includes(r.status),
  )
  const handled = reminders.data.filter((r) =>
    ['COMPLETED', 'DISMISSED', 'CANCELLED'].includes(r.status),
  )

  // Grouping uses the server's bucket. Doing date maths here would make render impure
  // and duplicate a business rule the API already owns.
  const groups: Record<Group, Reminder[]> = {
    overdue: active.filter((r) => r.bucket === 'OVERDUE'),
    dueSoon: active.filter((r) => r.bucket === 'DUE_SOON'),
    upcoming: active.filter((r) => r.bucket === 'UPCOMING'),
  }

  const busy = snooze.isPending || dismiss.isPending || complete.isPending

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Everything the platform is watching for you, worst first."
        action={
          <Button variant="ghost" onClick={() => setShowHandled((v) => !v)}>
            {showHandled ? 'Hide handled' : 'Show handled'}
          </Button>
        }
      />

      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing needs your attention"
            description="Reminders appear here as services, MOT, insurance and tax approach their due dates. Add a maintenance schedule to a vehicle to start."
            action={
              <Link to="/vehicles" className="text-[13px] font-medium text-accent hover:underline">
                Go to your vehicles
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Section
            title="Overdue"
            tone="OVERDUE"
            items={groups.overdue}
            busy={busy}
            onSnooze={(id, days) => snooze.mutate({ id, days })}
            onDismiss={(id) => dismiss.mutate(id)}
            onComplete={(id) => complete.mutate(id)}
          />
          <Section
            title="Due soon"
            tone="DUE_SOON"
            items={groups.dueSoon}
            busy={busy}
            onSnooze={(id, days) => snooze.mutate({ id, days })}
            onDismiss={(id) => dismiss.mutate(id)}
            onComplete={(id) => complete.mutate(id)}
          />
          <Section
            title="Upcoming"
            tone="HEALTHY"
            items={groups.upcoming}
            busy={busy}
            onSnooze={(id, days) => snooze.mutate({ id, days })}
            onDismiss={(id) => dismiss.mutate(id)}
            onComplete={(id) => complete.mutate(id)}
          />
        </div>
      )}

      {showHandled && (
        <Card className="mt-5">
          <CardHeader title="Handled" description={`${handled.length} completed or dismissed.`} />
          <CardBody className="px-0 pb-0">
            {handled.length === 0 ? (
              <p className="px-5 pb-5 text-[13px] text-content-secondary">
                Nothing has been completed or dismissed yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                {handled.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="min-w-0 truncate text-[13.5px] text-content-secondary line-through">
                      {r.title}
                    </span>
                    <span className="shrink-0 text-[12px] text-content-tertiary">{r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </>
  )
}

function Section({
  title,
  tone,
  items,
  busy,
  onSnooze,
  onDismiss,
  onComplete,
}: {
  title: string
  tone: 'OVERDUE' | 'DUE_SOON' | 'HEALTHY'
  items: Reminder[]
  busy: boolean
  onSnooze: (id: string, days: number) => void
  onDismiss: (id: string) => void
  onComplete: (id: string) => void
}) {
  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader
        title={title}
        description={`${items.length} item${items.length === 1 ? '' : 's'}`}
      />
      <CardBody className="px-0 pb-0">
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium">{r.title}</span>
                  <StatusBadge status={tone} label={statusLabel(r)} />
                  {r.status === 'SNOOZED' && r.snoozedUntil && (
                    <span className="rounded border border-border-default px-1.5 py-px text-[11px] text-content-tertiary">
                      snoozed to {formatDate(r.snoozedUntil)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] text-content-secondary">
                  {r.vehicle && `${r.vehicle.manufacturer} ${r.vehicle.model}`}
                  {r.vehicle?.registrationNumber && ` · ${r.vehicle.registrationNumber}`}
                  {r.dueOn && ` · due ${formatDate(r.dueOn)}`}
                  {r.dueOdometer !== null &&
                    ` · at ${formatDistance(r.dueOdometer, r.dueOdometerUnit ?? 'MILES')}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                {r.actionUrl && (
                  <Link
                    to={r.actionUrl}
                    className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-accent hover:bg-accent-subtle"
                  >
                    Open
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onSnooze(r.id, 7)}
                >
                  Snooze 7d
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onComplete(r.id)}
                >
                  Done
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDismiss(r.id)}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

function statusLabel(r: Reminder): string {
  if (r.overdue) return 'Overdue'
  if (r.status === 'SNOOZED') return 'Snoozed'
  if (r.dueOn) {
    const days = Math.round((new Date(`${r.dueOn}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)
    if (days <= 0) return 'Due now'
    return `Due in ${days} day${days === 1 ? '' : 's'}`
  }
  return 'Scheduled'
}
