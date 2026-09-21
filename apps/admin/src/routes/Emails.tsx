import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardBody, Skeleton, cn } from '@autoservices/ui'
import { adminApi, type EmailMessage } from '../lib/api.js'
import { DataTable, StatusPill, Timestamp, type Column } from '../components/DataTable.js'

const STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'DELAYED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED',
]

/**
 * ADMIN-005 — email delivery inspection.
 *
 * The question this page exists to answer is "why didn't this user get their email?",
 * without anyone opening a database console.
 */
export function EmailsPage() {
  const [status, setStatus] = useState('')
  const [recipient, setRecipient] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const stats = useQuery({
    queryKey: ['admin-email-stats'],
    queryFn: () => adminApi.emailStats(),
    refetchInterval: 30_000,
  })

  const emails = useQuery({
    queryKey: ['admin-emails', status, recipient],
    queryFn: () =>
      adminApi.emails({
        status: status || undefined,
        recipient: recipient || undefined,
        limit: 100,
      }),
    refetchInterval: 30_000,
  })

  const columns: Column<EmailMessage>[] = [
    {
      key: 'status',
      header: 'Status',
      render: (m) => <StatusPill status={m.status} />,
    },
    {
      key: 'recipient',
      header: 'Recipient',
      render: (m) => <span className="font-mono text-[11.5px]">{m.recipientEmail}</span>,
    },
    { key: 'template', header: 'Template', render: (m) => m.template },
    {
      key: 'subject',
      header: 'Subject',
      render: (m) => <span className="block max-w-[22rem] truncate">{m.subject}</span>,
    },
    { key: 'provider', header: 'Provider', render: (m) => m.provider },
    { key: 'created', header: 'Created', render: (m) => <Timestamp value={m.createdAt} /> },
    { key: 'delivered', header: 'Delivered', render: (m) => <Timestamp value={m.deliveredAt} /> },
    {
      key: 'events',
      header: 'Events',
      numeric: true,
      render: (m) =>
        m.events.length === 0 ? (
          <span className="text-content-tertiary">0</span>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(expanded === m.id ? null : m.id)}
            className="font-medium text-accent hover:underline"
          >
            {m.events.length}
          </button>
        ),
    },
  ]

  const selected = emails.data?.find((m) => m.id === expanded)

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Email delivery</h1>
        <p className="mt-0.5 text-[13px] text-content-secondary">
          Application-side history. Never rely on the provider dashboard as the record.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total messages" value={stats.data?.total} loading={stats.isPending} />
        <StatTile
          label="Delivered"
          value={stats.data?.byStatus.DELIVERED ?? 0}
          loading={stats.isPending}
          tone="ok"
        />
        <StatTile
          label="Failed / bounced"
          value={(stats.data?.byStatus.FAILED ?? 0) + (stats.data?.byStatus.BOUNCED ?? 0)}
          loading={stats.isPending}
          tone="bad"
        />
        <StatTile
          label="Failure rate"
          value={stats.data ? `${stats.data.failureRatePercent}%` : undefined}
          loading={stats.isPending}
          tone={(stats.data?.failureRatePercent ?? 0) > 5 ? 'bad' : 'neutral'}
        />
      </div>

      <DataTable
        title="Messages"
        description="Newest first. Refreshes every 30 seconds."
        columns={columns}
        rows={emails.data}
        isPending={emails.isPending}
        error={emails.error}
        onRetry={() => void emails.refetch()}
        rowKey={(m) => m.id}
        emptyTitle={status || recipient ? 'No messages match these filters' : 'No emails sent yet'}
        emptyDescription={
          status || recipient
            ? 'Try a different status or recipient.'
            : 'Messages appear here as soon as they are queued, before the provider is called.'
        }
        toolbar={
          <>
            <label htmlFor="recipient" className="sr-only">
              Filter by recipient
            </label>
            <input
              id="recipient"
              type="search"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Filter by recipient"
              className="h-8 min-w-56 flex-1 rounded-md border border-border-default bg-surface-raised px-2.5 text-[12.5px]"
            />
            <label htmlFor="status" className="sr-only">
              Filter by status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 rounded-md border border-border-default bg-surface-raised px-2 text-[12.5px]"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {(status || recipient) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatus('')
                  setRecipient('')
                }}
              >
                Clear
              </Button>
            )}
          </>
        }
      />

      {selected && (
        <Card className="mt-4">
          <CardBody className="pt-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold">{selected.subject}</p>
                <p className="mt-0.5 font-mono text-[11.5px] text-content-tertiary">
                  provider id: {selected.providerMessageId ?? '—'}
                </p>
                {/* The correlation id is what ties this message back to the request,
                    reminder and job that produced it (ARCHITECTURE.md §13). */}
                <p className="font-mono text-[11.5px] text-content-tertiary">
                  correlation: {selected.correlationId ?? '—'}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(null)}>
                Close
              </Button>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                  <th scope="col" className="px-3 py-1.5 font-medium text-content-secondary">
                    Event
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium text-content-secondary">
                    Occurred
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {selected.events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-1.5 font-mono">{e.eventType}</td>
                    <td className="px-3 py-1.5">
                      <Timestamp value={e.occurredAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </>
  )
}

function StatTile({
  label,
  value,
  loading,
  tone = 'neutral',
}: {
  label: string
  value: number | string | undefined
  loading: boolean
  tone?: 'ok' | 'bad' | 'neutral'
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <p
          className={cn(
            'tabular mt-1 text-[20px] font-semibold tracking-tight',
            tone === 'ok' && 'text-status-healthy',
            tone === 'bad' && value !== 0 && value !== '0%' && 'text-status-overdue',
          )}
        >
          {value ?? '—'}
        </p>
      )}
    </Card>
  )
}
