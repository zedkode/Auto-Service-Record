import type { ReactNode } from 'react'

/** Shared chrome for every unauthenticated screen, so they stay visually consistent. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-surface-base px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-white">
            <svg
              viewBox="0 0 20 20"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12.5h14M5 12.5v1.8a.8.8 0 0 0 .8.8h1.2a.8.8 0 0 0 .8-.8v-1.8M12.2 12.5v1.8a.8.8 0 0 0 .8.8h1.2a.8.8 0 0 0 .8-.8v-1.8M3.8 12.2 5.3 7.8A1.6 1.6 0 0 1 6.8 6.7h6.4a1.6 1.6 0 0 1 1.5 1.1l1.5 4.4" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[13.5px] text-content-secondary">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function FieldErrors({ error }: { error?: string }) {
  if (!error) return null
  return (
    <p role="alert" className="mt-1.5 text-[12px] font-medium text-status-overdue">
      {error}
    </p>
  )
}
