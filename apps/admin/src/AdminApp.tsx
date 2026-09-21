import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Route, Routes } from 'react-router'
import { cn } from '@autoservices/ui'
import { AdminSignIn } from './components/AdminSignIn.js'
import { adminApi } from './lib/api.js'
import { OverviewPage } from './routes/Overview.js'
import { PlaceholderPage } from './routes/Placeholder.js'
import { EmailsPage } from './routes/Emails.js'
import { SuppressionsPage } from './routes/Suppressions.js'
import { SupportAccessPage } from './routes/SupportAccess.js'
import { JobsPage } from './routes/Jobs.js'
import { AuditPage } from './routes/Audit.js'

/**
 * The admin application is a SEPARATE build on a SEPARATE origin with a SEPARATE auth
 * realm (ADR-010). It is never a route inside the customer dashboard, and it never
 * shares a session cookie with it.
 *
 * Admin authentication (ADMIN-001) is a Phase 9 task; until it exists this app is
 * read-only and shows only aggregate, non-identifying platform data.
 */
const NAV = [
  { to: '/', label: 'Overview', ready: true },
  { to: '/users', label: 'Users' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/emails', label: 'Emails', ready: true },
  { to: '/suppressions', label: 'Suppressions', ready: true },
  { to: '/jobs', label: 'Jobs', ready: true },
  { to: '/support-access', label: 'Support access', ready: true },
  { to: '/audit', label: 'Audit logs', ready: true },
  { to: '/system', label: 'System', ready: true },
]

export function AdminApp() {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: ['admin-session'],
    queryFn: () => adminApi.auth.session(),
    retry: false,
    staleTime: 60_000,
  })

  if (session.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-base">
        <p className="text-[13px] text-content-secondary">Checking your session…</p>
      </div>
    )
  }

  // Any failure here means "not signed in": the API answers 404 rather than confirming
  // the console exists to an unauthenticated caller.
  if (session.error || !session.data) {
    return <AdminSignIn onSignedIn={(next) => queryClient.setQueryData(['admin-session'], next)} />
  }

  const admin = session.data.admin

  async function signOut() {
    try {
      await adminApi.auth.logout()
    } finally {
      queryClient.clear()
      // Hard navigation so no stale operational data survives the sign-out.
      window.location.reload()
    }
  }

  return (
    <div className="min-h-dvh bg-surface-base">
      {/* A visually distinct top bar so an operator always knows which app they are in. */}
      <header className="sticky top-0 z-40 border-b border-border-default bg-surface-inverse text-content-inverse">
        <div className="mx-auto flex h-12 w-full max-w-[1600px] items-center gap-4 px-4">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <span className="flex size-6 items-center justify-center rounded bg-white/15">
              <svg
                viewBox="0 0 20 20"
                className="size-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M5 6h10M5 10h10M5 14h7" />
              </svg>
            </span>
            AutoServices
          </span>
          <span className="rounded bg-status-attention/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-status-attention">
            Operations
          </span>
          <div className="flex-1" />
          <span className="text-[12px] opacity-70">{admin.email}</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider">
            {admin.role.replace('_', ' ')}
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded px-2 py-1 text-[12px] font-medium opacity-80 hover:bg-white/10 hover:opacity-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-12 hidden h-[calc(100dvh-3rem)] w-52 shrink-0 border-r border-border-subtle px-2 py-3 md:block">
          <nav aria-label="Admin">
            <ul className="space-y-0.5">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center justify-between rounded px-2.5 py-1.5 text-[13px] font-medium',
                        isActive
                          ? 'bg-accent-subtle text-accent'
                          : 'text-content-secondary hover:bg-surface-sunken',
                      )
                    }
                  >
                    {n.label}
                    {!n.ready && (
                      <span className="rounded border border-border-default px-1 text-[9.5px] text-content-tertiary">
                        P9
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/system" element={<OverviewPage />} />
            <Route path="/users" element={<PlaceholderPage title="Users" />} />
            <Route path="/workspaces" element={<PlaceholderPage title="Workspaces" />} />
            <Route path="/vehicles" element={<PlaceholderPage title="Vehicles" />} />
            <Route path="/emails" element={<EmailsPage />} />
            <Route path="/suppressions" element={<SuppressionsPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/support-access" element={<SupportAccessPage />} />
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
