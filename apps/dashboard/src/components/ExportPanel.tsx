/**
 * EXP-001 — request an export, watch it build, download it.
 *
 * The file is produced by a worker, so this is inherently a "come back in a moment"
 * interaction. It is polled rather than pushed because a data export is not urgent enough
 * to justify a socket, and a page that says nothing while a job runs is indistinguishable
 * from one that has forgotten the request.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { can } from '@autoservices/permissions'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SelectField,
  formatDate,
} from '@autoservices/ui'
import {
  ApiError,
  type ExportFormat,
  type ExportJob,
  type ExportKind,
} from '@autoservices/api-client'
import { api } from '../lib/api.js'
import { useSession } from '../lib/use-session.js'

const KINDS: Array<{ value: ExportKind; label: string }> = [
  { value: 'EXPENSES', label: 'Costs and expenses' },
  { value: 'SERVICES', label: 'Service history' },
  { value: 'FUEL', label: 'Fuel and charging' },
  { value: 'ODOMETER', label: 'Mileage readings' },
  { value: 'VEHICLES', label: 'Vehicles' },
]

/** Colour through `className`, which is the API `Badge` actually has. */
const STATUS_CLASS: Record<ExportJob['status'], string> = {
  PENDING: '',
  RUNNING: '',
  READY: 'border-transparent bg-status-healthy-subtle text-status-healthy',
  FAILED: 'border-transparent bg-status-overdue-subtle text-status-overdue',
  EXPIRED: 'border-transparent bg-status-due-soon-subtle text-status-due-soon',
}

const STATUS_LABEL: Record<ExportJob['status'], string> = {
  PENDING: 'Queued',
  RUNNING: 'Preparing',
  READY: 'Ready',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
}

function size(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ExportPanel({ from, to }: { from: string; to: string }) {
  const { workspace } = useSession()
  const queryClient = useQueryClient()
  const mayExport = can(workspace.role, 'export:create')
  const [kind, setKind] = useState<ExportKind>('EXPENSES')
  const [format, setFormat] = useState<ExportFormat>('CSV')
  const [failure, setFailure] = useState<string | null>(null)

  const jobs = useQuery({
    queryKey: ['exports', workspace.id],
    queryFn: () => api.exports.list(workspace.id),
    // Poll only while something is actually being built, so an idle page is idle.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((j) => j.status === 'PENDING' || j.status === 'RUNNING')
        ? 1500
        : false,
  })

  const request = useMutation({
    mutationFn: () => api.exports.create(workspace.id, { kind, format, from, to }),
    onSuccess: () => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: ['exports', workspace.id] })
    },
    onError: (err) =>
      setFailure(err instanceof ApiError ? err.message : 'The export could not be requested.'),
  })

  const download = useMutation({
    mutationFn: (id: string) => api.exports.download(workspace.id, id),
    onSuccess: (data) => {
      setFailure(null)
      // Navigating to the signed URL rather than fetching it: the browser handles the
      // Content-Disposition and the file never passes through JavaScript memory.
      window.location.assign(data.url)
    },
    onError: (err) => {
      setFailure(err instanceof ApiError ? err.message : 'That download could not be started.')
      void queryClient.invalidateQueries({ queryKey: ['exports', workspace.id] })
    },
  })

  return (
    <Card className="mt-6">
      <CardHeader
        title="Export your data"
        description="Prepared in the background. Download links last two minutes and the file itself is kept for a day."
      />
      <CardBody className="pt-0">
        {mayExport ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <SelectField
              name="exportKind"
              label="What to export"
              value={kind}
              onChange={(e) => setKind(e.target.value as ExportKind)}
            >
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              name="exportFormat"
              label="Format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <option value="CSV">CSV (spreadsheet)</option>
              <option value="JSON">JSON</option>
            </SelectField>
            <Button onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? 'Requesting…' : 'Request export'}
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-content-secondary">
            Your role can view this workspace but not export it. Ask an owner or admin.
          </p>
        )}

        {failure && (
          <p role="alert" className="mt-3 text-[13px] text-status-overdue">
            {failure}
          </p>
        )}
      </CardBody>

      {(jobs.data ?? []).length === 0 ? (
        <EmptyState
          title="No exports yet"
          description={
            mayExport
              ? 'Request one above and it will appear here when it is ready.'
              : 'Nothing has been exported from this workspace.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle border-t border-border-subtle">
          {(jobs.data ?? []).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
              <Badge className={STATUS_CLASS[job.status]}>{STATUS_LABEL[job.status]}</Badge>
              <span className="text-[13px] font-medium">
                {KINDS.find((k) => k.value === job.kind)?.label ?? job.kind}
              </span>
              <span className="text-[12px] text-content-tertiary">
                {job.format}
                {job.rowCount !== null && ` · ${job.rowCount.toLocaleString()} rows`}
                {job.byteSize !== null && ` · ${size(job.byteSize)}`}
                {job.createdAt && ` · ${formatDate(job.createdAt)}`}
              </span>
              <span className="ml-auto">
                {job.status === 'READY' && (
                  <Button
                    variant="secondary"
                    onClick={() => download.mutate(job.id)}
                    disabled={download.isPending}
                  >
                    Download
                  </Button>
                )}
                {job.status === 'FAILED' && (
                  <span className="text-[12.5px] text-status-overdue">{job.error}</span>
                )}
                {job.status === 'EXPIRED' && (
                  <span className="text-[12.5px] text-content-tertiary">
                    File removed — request it again
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
