import { useQuery } from '@tanstack/react-query'
import { Card, CardBody, CardHeader, Skeleton, cn } from '@autoservices/ui'
import { adminApi, type QueueCounts } from '../lib/api.js'
import { DataTable, type Column } from '../components/DataTable.js'

/** ADMIN-006 (read-only slice) — queue depth and failure visibility. */
export function JobsPage() {
  const queues = useQuery({
    queryKey: ['admin-queues'],
    queryFn: () => adminApi.queues(),
    refetchInterval: 10_000,
  })

  const columns: Column<QueueCounts>[] = [
    { key: 'name', header: 'Queue', render: (q) => <span className="font-medium">{q.name}</span> },
    { key: 'waiting', header: 'Waiting', numeric: true, render: (q) => q.counts.waiting ?? 0 },
    { key: 'active', header: 'Active', numeric: true, render: (q) => q.counts.active ?? 0 },
    { key: 'delayed', header: 'Delayed', numeric: true, render: (q) => q.counts.delayed ?? 0 },
    {
      key: 'completed',
      header: 'Completed',
      numeric: true,
      render: (q) => <span className="text-status-healthy">{q.counts.completed ?? 0}</span>,
    },
    {
      key: 'failed',
      header: 'Failed',
      numeric: true,
      render: (q) => (
        <span className={cn((q.counts.failed ?? 0) > 0 && 'font-semibold text-status-overdue')}>
          {q.counts.failed ?? 0}
        </span>
      ),
    },
  ]

  const totalFailed = (queues.data ?? []).reduce((s, q) => s + (q.counts.failed ?? 0), 0)
  const backlog = (queues.data ?? []).reduce(
    (s, q) => s + (q.counts.waiting ?? 0) + (q.counts.active ?? 0),
    0,
  )

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Background jobs</h1>
        <p className="mt-0.5 text-[13px] text-content-secondary">
          Queue depth and failures. Refreshes every 10 seconds.
        </p>
      </div>

      {totalFailed > 0 && (
        <div className="mb-4 rounded-lg border border-status-overdue/30 bg-status-overdue-subtle px-4 py-3">
          <p className="text-[13px] font-medium text-status-overdue">
            {totalFailed} failed job{totalFailed === 1 ? '' : 's'} across all queues.
          </p>
          <p className="mt-0.5 text-[12.5px] text-content-secondary">
            Retry from the queue is ADMIN-006 and is not built yet — investigate via the worker logs
            for now.
          </p>
        </div>
      )}

      {backlog > 20 && (
        <div className="mb-4 rounded-lg border border-status-due-soon/30 bg-status-due-soon-subtle px-4 py-3 text-[13px] text-status-due-soon">
          {backlog} jobs waiting or in flight — the worker may be behind.
        </div>
      )}

      <DataTable
        title="Queues"
        columns={columns}
        rows={queues.data}
        isPending={queues.isPending}
        error={queues.error}
        onRetry={() => void queues.refetch()}
        rowKey={(q) => q.name}
        emptyTitle="No queues reported"
        emptyDescription="The API could not reach Redis, or no queues are registered."
      />

      <Card className="mt-4">
        <CardHeader
          title="What runs here"
          description="Defined in the worker; see ARCHITECTURE.md §12."
        />
        <CardBody className="px-0 pb-0">
          <table className="w-full text-[12.5px]">
            <tbody className="divide-y divide-border-subtle border-t border-border-subtle">
              {[
                ['emails', 'Renders and sends every outbound message', 'live'],
                ['notifications', 'Hourly reminder sweep and notification fan-out', 'live'],
                ['maintenance', 'Due-state recomputation after data changes', 'reserved'],
                ['documents', 'Post-upload processing', 'reserved'],
                ['reports', 'Async report and export generation', 'reserved'],
                ['cleanup', 'Expired tokens and orphaned uploads', 'reserved'],
              ].map(([name, purpose, state]) => (
                <tr key={name}>
                  <td className="px-4 py-1.5 font-mono">{name}</td>
                  <td className="px-4 py-1.5 text-content-secondary">{purpose}</td>
                  <td className="px-4 py-1.5">
                    <span
                      className={cn(
                        'rounded px-1.5 py-px text-[11px] font-medium',
                        state === 'live'
                          ? 'bg-status-healthy-subtle text-status-healthy'
                          : 'bg-status-neutral-subtle text-status-neutral',
                      )}
                    >
                      {state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  )
}

export function JobsSkeleton() {
  return <Skeleton className="h-40 w-full" />
}
