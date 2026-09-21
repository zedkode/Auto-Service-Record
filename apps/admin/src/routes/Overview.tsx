import { useQuery } from '@tanstack/react-query'
import { Card, CardBody, CardHeader, Skeleton, cn } from '@autoservices/ui'
import { adminApi } from '../lib/api.js'

declare const __API_URL__: string

interface HealthReady {
  status: string
  checks: Record<string, string>
  timestamp: string
}

/**
 * Real platform health, read from the API's own health endpoint. Customer-identifying
 * data is deliberately absent until admin authentication exists (Phase 9).
 */
export function OverviewPage() {
  const health = useQuery({
    queryKey: ['admin-health'],
    queryFn: async (): Promise<HealthReady> => {
      const res = await fetch(`${__API_URL__}/api/v1/health/ready`)
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const live = useQuery({
    queryKey: ['admin-live'],
    queryFn: async (): Promise<{ status: string; uptime: number }> => {
      const res = await fetch(`${__API_URL__}/api/v1/health/live`)
      return res.json()
    },
    refetchInterval: 10_000,
  })

  // Platform counts, now that operational endpoints exist. Still no customer content:
  // counts and delivery state only (SECURITY.md §13).
  const metrics = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => adminApi.metrics(),
    refetchInterval: 30_000,
  })
  const emailStats = useQuery({
    queryKey: ['admin-email-stats'],
    queryFn: () => adminApi.emailStats(),
    refetchInterval: 30_000,
  })

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">System overview</h1>
          <p className="mt-0.5 text-[13px] text-content-secondary">
            Live platform health. Refreshes every 10 seconds.
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          label="API"
          value={
            health.data?.status === 'ok'
              ? 'Operational'
              : health.isError
                ? 'Unreachable'
                : 'Degraded'
          }
          tone={health.data?.status === 'ok' ? 'ok' : 'bad'}
          loading={health.isPending}
        />
        <StatusTile
          label="Database"
          value={health.data?.checks.database === 'up' ? 'Connected' : 'Down'}
          tone={health.data?.checks.database === 'up' ? 'ok' : 'bad'}
          loading={health.isPending}
        />
        <StatusTile
          label="API uptime"
          value={live.data ? formatUptime(live.data.uptime) : '—'}
          tone="neutral"
          loading={live.isPending}
        />
        <StatusTile label="Environment" value="development" tone="neutral" loading={false} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Users', metrics.data?.users],
          ['Workspaces', metrics.data?.workspaces],
          ['Vehicles', metrics.data?.vehicles],
          ['Services', metrics.data?.services],
          ['Active reminders', metrics.data?.activeReminders],
          ['Emails sent', emailStats.data?.total],
        ].map(([label, value]) => (
          <Card key={String(label)} className="px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">
              {label}
            </p>
            {metrics.isPending || emailStats.isPending ? (
              <Skeleton className="mt-1.5 h-5 w-10" />
            ) : (
              <p className="tabular mt-1 text-[18px] font-semibold tracking-tight">
                {value ?? '—'}
              </p>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dependency checks" description="Reported by /api/v1/health/ready" />
          <CardBody className="px-0 pb-0">
            {health.isPending ? (
              <div className="space-y-2 px-5 pb-5">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : health.isError ? (
              <p className="px-5 pb-5 text-[13px] text-status-overdue">
                Could not reach the API at {__API_URL__}.
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Check
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {Object.entries(health.data.checks).map(([name, status]) => (
                    <tr key={name}>
                      <td className="px-5 py-2.5 capitalize">{name}</td>
                      <td className="px-5 py-2.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium',
                            status === 'up'
                              ? 'bg-status-healthy-subtle text-status-healthy'
                              : 'bg-status-overdue-subtle text-status-overdue',
                          )}
                        >
                          <span aria-hidden="true">{status === 'up' ? '✓' : '✕'}</span>
                          {status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Roadmap status" description="What this console will do" />
          <CardBody className="px-0 pb-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                  <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                    Module
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium text-content-secondary">
                    Phase
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {[
                  ['Admin authentication + 2FA', 'Phase 9 — ADMIN-001'],
                  ['User & workspace inspection', 'Phase 9 — ADMIN-004'],
                  ['Email delivery inspection', 'Phase 9 — ADMIN-005'],
                  ['Queue & failed job management', 'Phase 9 — ADMIN-006'],
                  ['Audit log viewer', 'Phase 9 — ADMIN-007'],
                  ['Audited support access', 'Phase 9 — SEC-018'],
                ].map(([m, p]) => (
                  <tr key={m}>
                    <td className="px-5 py-2.5">{m}</td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-content-tertiary">{p}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 rounded-lg border border-border-default bg-surface-sunken px-4 py-3">
        <p className="text-[13px] font-medium">Staff realm</p>
        <p className="mt-1 text-[12.5px] text-content-secondary">
          Signed in with a password and an authenticator code, on a session separate from any
          customer account. These endpoints expose operational data only — delivery state, queue
          depth and counts. Reading a customer&apos;s documents or vehicle content requires an
          audited support access grant, which is not built yet (SEC-018).
        </p>
      </div>
    </>
  )
}

function StatusTile({
  label,
  value,
  tone,
  loading,
}: {
  label: string
  value: string
  tone: 'ok' | 'bad' | 'neutral'
  loading: boolean
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-20" />
      ) : (
        <p
          className={cn(
            'mt-1 text-[17px] font-semibold tracking-tight',
            tone === 'ok' && 'text-status-healthy',
            tone === 'bad' && 'text-status-overdue',
          )}
        >
          {value}
        </p>
      )}
    </Card>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}
