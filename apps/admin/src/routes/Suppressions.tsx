import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardBody } from '@autoservices/ui'
import { adminApi, type Suppression } from '../lib/api.js'
import { DataTable, Timestamp, type Column } from '../components/DataTable.js'

const REASON_STYLE: Record<Suppression['reason'], string> = {
  HARD_BOUNCE: 'bg-status-overdue-subtle text-status-overdue',
  COMPLAINT: 'bg-status-overdue-subtle text-status-overdue',
  MANUAL: 'bg-surface-sunken text-content-secondary',
}

/**
 * MAIL-005 — the addresses we refuse to send to, and why.
 *
 * Operationally this is the page someone opens when a user says "I stopped getting
 * reminders": if the address is here, that is the answer, and releasing it is one click
 * rather than a hand-written UPDATE in production.
 */
export function SuppressionsPage() {
  const [includeReleased, setIncludeReleased] = useState(false)
  const queryClient = useQueryClient()

  const suppressions = useQuery({
    queryKey: ['admin-suppressions', includeReleased],
    queryFn: () => adminApi.suppressions(includeReleased),
    refetchInterval: 30_000,
  })

  const release = useMutation({
    mutationFn: (email: string) => adminApi.releaseSuppression(email),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-suppressions'] }),
  })

  const columns: Column<Suppression>[] = [
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${REASON_STYLE[r.reason]}`}
        >
          {r.reason.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Address',
      render: (r) => <span className="font-mono">{r.email}</span>,
    },
    {
      key: 'detail',
      header: 'Detail',
      render: (r) => <span className="text-content-secondary">{r.detail ?? '—'}</span>,
    },
    { key: 'createdAt', header: 'Added', render: (r) => <Timestamp value={r.createdAt} /> },
    {
      key: 'state',
      header: 'State',
      render: (r) =>
        r.releasedAt ? (
          <span className="text-content-secondary">
            released <Timestamp value={r.releasedAt} />
          </span>
        ) : (
          <span className="font-medium">active</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.releasedAt ? null : (
          <Button
            variant="secondary"
            onClick={() => release.mutate(r.email)}
            loading={release.isPending && release.variables === r.email}
          >
            Release
          </Button>
        ),
    },
  ]

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Suppressed addresses</h1>
        <p className="mt-1 text-[13px] text-content-secondary">
          Mail is not sent to these addresses. A hard bounce blocks everything; a spam complaint
          still allows account and security mail, so nobody is locked out of their own password
          reset.
        </p>
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={includeReleased}
              onChange={(e) => setIncludeReleased(e.target.checked)}
            />
            Show released entries
          </label>
          {release.isError && (
            <span className="text-[13px] text-status-overdue">Could not release that address.</span>
          )}
        </CardBody>
      </Card>

      <DataTable
        title="Suppression list"
        description="Populated from provider bounce and complaint webhooks."
        rows={suppressions.data}
        isPending={suppressions.isPending}
        error={suppressions.error}
        onRetry={() => void suppressions.refetch()}
        columns={columns}
        rowKey={(r) => r.id}
        emptyTitle="No suppressed addresses"
        emptyDescription="Nothing has hard-bounced or been reported as spam."
      />
    </>
  )
}
