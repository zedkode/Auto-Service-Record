/**
 * A styled representation of the product surface for the hero. Deliberately not a
 * screenshot: it renders crisply at any width and stays honest about what the product
 * shows. Real screenshots replace this once the dashboard is feature-complete.
 */
export function DashboardPreview() {
  return (
    <div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-lg">
      {/* Chrome */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-sunken px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </div>
        <div className="ml-2 flex-1 rounded bg-surface-raised px-2.5 py-1 text-[11px] text-content-tertiary">
          app.autoservices.example
        </div>
      </div>

      <div className="grid sm:grid-cols-[180px_1fr]">
        {/* Sidebar */}
        <div className="hidden border-r border-border-subtle p-3 sm:block">
          {['Overview', 'Vehicles', 'Service', 'Maintenance', 'Reminders', 'Expenses'].map(
            (l, i) => (
              <div
                key={l}
                className={`mb-0.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium ${
                  i === 0 ? 'bg-accent-subtle text-accent' : 'text-content-secondary'
                }`}
              >
                {l}
              </div>
            ),
          )}
        </div>

        {/* Body */}
        <div className="p-4">
          <div className="mb-3 rounded-lg border border-status-attention/25 bg-status-attention-subtle px-3.5 py-2.5">
            <p className="text-[12px] font-semibold text-status-attention">Attention required</p>
            <p className="mt-0.5 text-[12.5px] text-content-secondary">
              Ford Mondeo — oil service due in 620 miles
            </p>
          </div>

          <div className="mb-3 grid grid-cols-4 gap-2">
            {[
              ['Vehicles', '3'],
              ['Due soon', '2'],
              ['Overdue', '1'],
              ['This month', '£427'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border-subtle px-2.5 py-2">
                <p className="text-[10.5px] text-content-tertiary">{label}</p>
                <p className="mt-0.5 text-[16px] font-semibold tracking-tight">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              ['Ford Mondeo', 'AB16 CDE', '131,260'],
              ['BMW 530d', 'BD64 XYZ', '104,880'],
              ['Volvo V60', 'PL17 VOL', '91,250'],
            ].map(([name, plate, miles]) => (
              <div key={name} className="overflow-hidden rounded-lg border border-border-subtle">
                <div className="grid h-12 place-items-center bg-surface-sunken">
                  <svg
                    viewBox="0 0 120 60"
                    className="h-7 text-border-strong"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 40h104" />
                    <path d="M10 39 17 20a7 7 0 0 1 6.6-4.6h33.8A7 7 0 0 1 63 18l10 8h18a12 12 0 0 1 11 9l1 4" />
                  </svg>
                </div>
                <div className="p-2">
                  <p className="truncate text-[11.5px] font-semibold">{name}</p>
                  <p className="font-mono text-[10px] text-content-tertiary">{plate}</p>
                  <p className="mt-1 text-[13px] font-semibold tracking-tight">
                    {miles}{' '}
                    <span className="text-[9.5px] font-normal text-content-tertiary">mi</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
