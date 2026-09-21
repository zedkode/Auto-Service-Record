import { cn } from '../cn.js'
import type { TrackingStatus } from '../types.js'

/**
 * Status is NEVER conveyed by colour alone — every badge pairs a colour with an icon
 * and a text label (UI_UX.md §2.1, §6). Roughly 1 in 12 men has a colour-vision
 * deficiency, and a fleet manager who cannot tell "due soon" from "overdue" is the
 * user we failed.
 */
const CONFIG: Record<TrackingStatus, { label: string; icon: string; className: string }> = {
  HEALTHY: {
    label: 'Up to date',
    icon: '✓',
    className: 'text-status-healthy bg-status-healthy-subtle',
  },
  DUE_SOON: {
    label: 'Due soon',
    icon: '◷',
    className: 'text-status-due-soon bg-status-due-soon-subtle',
  },
  ATTENTION: {
    label: 'Needs attention',
    icon: '!',
    className: 'text-status-attention bg-status-attention-subtle',
  },
  OVERDUE: {
    label: 'Overdue',
    icon: '✕',
    className: 'text-status-overdue bg-status-overdue-subtle',
  },
  UNKNOWN: {
    label: 'Not tracked',
    icon: '?',
    className: 'text-status-neutral bg-status-neutral-subtle',
  },
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: TrackingStatus
  label?: string
  className?: string
}) {
  const cfg = CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium',
        cfg.className,
        className,
      )}
    >
      <span aria-hidden="true" className="text-[11px] leading-none">
        {cfg.icon}
      </span>
      {label ?? cfg.label}
    </span>
  )
}

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border-default bg-surface-sunken px-2 py-0.5 text-[12px] font-medium text-content-secondary',
        className,
      )}
    >
      {children}
    </span>
  )
}
