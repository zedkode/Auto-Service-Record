import type { ReactNode } from 'react'
import { cn } from '../cn.js'
import { Button } from './Button.js'

/**
 * Every data view must specify loading, empty, filtered-empty and error states.
 * A component that renders only the happy path is incomplete (UI_UX.md §9).
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      aria-hidden="true"
    />
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-content-tertiary">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-content-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-content-secondary">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
  className,
}: {
  title?: string
  message: string
  requestId?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <div
        className="mb-3 flex size-9 items-center justify-center rounded-full bg-status-overdue-subtle text-status-overdue"
        aria-hidden="true"
      >
        !
      </div>
      <h3 className="text-[15px] font-semibold text-content-primary">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-content-secondary">{message}</p>
      {onRetry && (
        <Button className="mt-4" onClick={onRetry} variant="secondary" size="sm">
          Try again
        </Button>
      )}
      {/* Support can trace this exact request end to end. */}
      {requestId && (
        <p className="mt-3 font-mono text-[11px] text-content-tertiary">Reference: {requestId}</p>
      )}
    </div>
  )
}
