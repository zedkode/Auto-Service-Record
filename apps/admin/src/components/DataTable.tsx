import type { ReactNode } from 'react'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, cn } from '@autoservices/ui'
import { AdminApiError } from '../lib/api.js'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  /** Right-align numeric columns so they read as a column of figures. */
  numeric?: boolean
  className?: string
}

/**
 * Shared operational table (task brief §43).
 *
 * Density over decoration: this is an internal tool where reading many rows quickly
 * matters more than whitespace (UI_UX.md §19).
 */
export function DataTable<T>({
  title,
  description,
  columns,
  rows,
  isPending,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  toolbar,
  rowKey,
}: {
  title: string
  description?: string
  columns: Column<T>[]
  rows: T[] | undefined
  isPending: boolean
  error: unknown
  onRetry?: () => void
  emptyTitle: string
  emptyDescription: string
  toolbar?: ReactNode
  rowKey: (row: T) => string
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          rows ? (
            <span className="tabular text-[12px] text-content-tertiary">{rows.length} rows</span>
          ) : undefined
        }
      />
      {toolbar && <div className="flex flex-wrap gap-2 px-5 pb-3">{toolbar}</div>}
      <CardBody className="px-0 pb-0">
        {isPending ? (
          <div className="space-y-2 px-5 pb-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            title={
              error instanceof AdminApiError && error.status === 404 ? 'Not authorised' : undefined
            }
            message={error instanceof Error ? error.message : 'Could not load this data.'}
            onRetry={onRetry}
          />
        ) : !rows || rows.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-y border-border-subtle bg-surface-sunken/50 text-left">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn(
                        'whitespace-nowrap px-4 py-1.5 font-medium text-content-secondary',
                        c.numeric && 'text-right',
                      )}
                    >
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="hover:bg-surface-sunken/60">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          'px-4 py-1.5 align-top',
                          c.numeric && 'tabular text-right',
                          c.className,
                        )}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Compact status pill sized for dense tables. */
export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'DELIVERED' || status === 'SENT'
      ? 'bg-status-healthy-subtle text-status-healthy'
      : status === 'BOUNCED' || status === 'FAILED' || status === 'COMPLAINED'
        ? 'bg-status-overdue-subtle text-status-overdue'
        : status === 'QUEUED' || status === 'SENDING' || status === 'DELAYED'
          ? 'bg-status-due-soon-subtle text-status-due-soon'
          : 'bg-status-neutral-subtle text-status-neutral'
  return (
    <span className={cn('inline-block rounded px-1.5 py-px text-[11px] font-medium', tone)}>
      {status}
    </span>
  )
}

export function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span className="text-content-tertiary">—</span>
  const d = new Date(value)
  return (
    <span className="tabular whitespace-nowrap text-content-secondary" title={d.toISOString()}>
      {d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })}
    </span>
  )
}
