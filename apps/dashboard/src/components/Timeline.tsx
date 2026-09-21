import { formatDate, formatMoney } from '@autoservices/ui'
import type { TimelineEvent } from '@autoservices/api-client'

/**
 * Reusable event timeline. Deliberately NOT coupled to services — it renders whatever
 * event types the API returns, so new sources (service, MOT, fuel, expenses) appear here
 * without changing this component (task brief §17).
 */
const TYPE_STYLES: Record<string, { dot: string; label: string }> = {
  ODOMETER: { dot: 'bg-accent', label: 'Mileage' },
  SERVICE: { dot: 'bg-status-healthy', label: 'Service' },
  INSPECTION: { dot: 'bg-status-due-soon', label: 'Inspection' },
  FUEL: { dot: 'bg-status-neutral', label: 'Fuel' },
  EXPENSE: { dot: 'bg-status-attention', label: 'Expense' },
  PURCHASE: { dot: 'bg-content-primary', label: 'Purchase' },
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const style = TYPE_STYLES[e.type] ?? TYPE_STYLES.ODOMETER!
        const isLast = i === events.length - 1
        return (
          <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
            {/* Rail */}
            <div className="flex w-24 shrink-0 flex-col items-end pt-0.5 text-right">
              {e.odometer && (
                <span className="tabular text-[12.5px] font-semibold text-content-primary">
                  {new Intl.NumberFormat('en-GB').format(e.odometer.value)}{' '}
                  {e.odometer.unit === 'MILES' ? 'mi' : 'km'}
                </span>
              )}
              <time className="text-[11.5px] text-content-tertiary">
                {formatDate(e.occurredOn)}
              </time>
            </div>

            {/* Node + connector */}
            <div className="relative flex flex-col items-center">
              <span
                className={`mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-surface-raised ${style.dot}`}
                aria-hidden="true"
              />
              {!isLast && (
                <span className="absolute top-4 h-full w-px bg-border-subtle" aria-hidden="true" />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13.5px] font-medium text-content-primary">{e.title}</p>
                {e.amount && (
                  <span className="tabular text-[13.5px] font-semibold text-content-primary">
                    {formatMoney(e.amount.amount, e.amount.currency)}
                  </span>
                )}
              </div>
              {e.description && (
                <p className="mt-0.5 text-[12.5px] text-content-secondary">{e.description}</p>
              )}
              <span className="mt-1 inline-block rounded border border-border-subtle px-1.5 py-px text-[10.5px] font-medium uppercase tracking-wide text-content-tertiary">
                {style.label}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
