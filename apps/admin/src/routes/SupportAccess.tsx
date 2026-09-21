import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, CardBody } from '@autoservices/ui'
import { adminApi, type SupportGrant } from '../lib/api.js'
import { DataTable, Timestamp, type Column } from '../components/DataTable.js'

const SCOPE_LABEL: Record<SupportGrant['scope'], string> = {
  VEHICLE_CONTENT: 'Vehicle content',
  DOCUMENTS: 'Documents',
  FULL: 'Full',
}

/**
 * SEC-018 — the support access register.
 *
 * Deliberately readable by every staff role, including those that cannot request access:
 * a register nobody reads is not oversight. The reason is shown in full, unabbreviated,
 * because it is the part a reviewer actually needs.
 */
export function SupportAccessPage() {
  const [includeExpired, setIncludeExpired] = useState(false)
  const queryClient = useQueryClient()

  const grants = useQuery({
    queryKey: ['support-access', includeExpired],
    queryFn: () => adminApi.supportAccess(includeExpired),
    refetchInterval: 30_000,
  })

  const revoke = useMutation({
    mutationFn: (id: string) => adminApi.revokeSupportAccess(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-access'] }),
  })

  const columns: Column<SupportGrant>[] = [
    {
      key: 'state',
      header: 'State',
      render: (g) =>
        g.isActive ? (
          <span className="inline-block rounded bg-status-attention-subtle px-1.5 py-0.5 text-[11px] font-medium text-status-attention">
            live
          </span>
        ) : (
          <span className="text-content-tertiary">{g.revokedAt ? 'revoked' : 'expired'}</span>
        ),
    },
    {
      key: 'adminEmail',
      header: 'Staff',
      render: (g) => <span className="font-mono">{g.adminEmail}</span>,
    },
    { key: 'workspaceName', header: 'Workspace', render: (g) => g.workspaceName },
    { key: 'scope', header: 'Scope', render: (g) => SCOPE_LABEL[g.scope] },
    {
      key: 'reason',
      header: 'Reason',
      render: (g) => <span className="text-content-secondary">{g.reason}</span>,
    },
    {
      key: 'uses',
      header: 'Uses',
      numeric: true,
      render: (g) => (
        <span className={g.useCount === 0 ? 'text-content-tertiary' : undefined}>{g.useCount}</span>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      render: (g) =>
        g.isActive ? <span>{g.minutesRemaining} min</span> : <Timestamp value={g.expiresAt} />,
    },
    {
      key: 'actions',
      header: '',
      render: (g) =>
        g.isActive ? (
          <Button
            variant="secondary"
            onClick={() => revoke.mutate(g.id)}
            loading={revoke.isPending && revoke.variables === g.id}
          >
            Revoke
          </Button>
        ) : null,
    },
  ]

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Support access</h1>
        <p className="mt-1 text-[13px] text-content-secondary">
          Staff cannot read a customer&apos;s vehicles or documents without a grant. Grants need a
          written reason, last at most 24 hours, and every use is recorded in the audit log — not
          just the granting.
        </p>
      </div>

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-3 py-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={includeExpired}
              onChange={(e) => setIncludeExpired(e.target.checked)}
            />
            Show expired and revoked
          </label>
          {revoke.isError && (
            <span className="text-[13px] text-status-overdue">
              Could not revoke — you can only revoke your own unless you are a super admin.
            </span>
          )}
        </CardBody>
      </Card>

      <DataTable
        title="Grants"
        description="Requested from a support tool or the API; shown here for everyone to see."
        rows={grants.data}
        isPending={grants.isPending}
        error={grants.error}
        onRetry={() => void grants.refetch()}
        columns={columns}
        rowKey={(g) => g.id}
        emptyTitle="No live support access"
        emptyDescription="No member of staff currently holds access to any customer's content."
      />
    </>
  )
}
