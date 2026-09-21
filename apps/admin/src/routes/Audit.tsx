import { useQuery } from '@tanstack/react-query'
import { adminApi, type AuditEntry } from '../lib/api.js'
import { DataTable, Timestamp, type Column } from '../components/DataTable.js'

/** ADMIN-007 (read-only slice) — the append-only audit trail. */
export function AuditPage() {
  const audit = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => adminApi.audit(100),
    refetchInterval: 30_000,
  })

  const columns: Column<AuditEntry>[] = [
    { key: 'when', header: 'When', render: (a) => <Timestamp value={a.createdAt} /> },
    {
      key: 'action',
      header: 'Action',
      render: (a) => <span className="font-mono text-[11.5px] font-medium">{a.action}</span>,
    },
    { key: 'actor', header: 'Actor', render: (a) => a.actorType },
    {
      key: 'resource',
      header: 'Resource',
      render: (a) => (
        <span className="font-mono text-[11.5px]">
          {a.resourceType}
          {a.resourceId ? `/${a.resourceId.slice(0, 8)}…` : ''}
        </span>
      ),
    },
    {
      key: 'workspace',
      header: 'Workspace',
      render: (a) =>
        a.workspaceId ? (
          <span className="font-mono text-[11.5px]">{a.workspaceId.slice(0, 8)}…</span>
        ) : (
          <span className="text-content-tertiary">—</span>
        ),
    },
    {
      key: 'metadata',
      header: 'Metadata',
      render: (a) =>
        a.metadata ? (
          <span className="block max-w-[20rem] truncate font-mono text-[11px] text-content-secondary">
            {JSON.stringify(a.metadata)}
          </span>
        ) : (
          <span className="text-content-tertiary">—</span>
        ),
    },
  ]

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Audit log</h1>
        <p className="mt-0.5 text-[13px] text-content-secondary">
          Append-only. Metadata is sanitised on write — passwords, tokens and secrets never reach
          this table.
        </p>
      </div>

      <DataTable
        title="Recent activity"
        description="Newest first, most recent 100 entries."
        columns={columns}
        rows={audit.data}
        isPending={audit.isPending}
        error={audit.error}
        onRetry={() => void audit.refetch()}
        rowKey={(a) => a.id}
        emptyTitle="No audit entries"
        emptyDescription="Entries appear as users and the system perform auditable actions."
      />
    </>
  )
}
