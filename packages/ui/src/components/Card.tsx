import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn.js'

/**
 * Cards are delineated by border and surface colour, not stacked drop shadows —
 * stacked shadows are what make a dashboard look like a template (UI_UX.md §2.4).
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border-subtle bg-surface-raised shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-content-primary">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-content-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}

export function CardDivider() {
  return <div className="h-px bg-border-subtle" />
}
