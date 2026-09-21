import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router'
import { can, type Permission } from '@autoservices/permissions'
import { Button, cn, Dialog } from '@autoservices/ui'
import { dashboardCopy } from '../lib/dashboard-copy.js'
import { useSession } from '../lib/use-session.js'
import { NotificationCenter } from './NotificationCenter.js'
import { shellCopy as copy } from '../lib/shell-copy.js'
import {
  IconOverview,
  IconCar,
  IconWrench,
  IconBell,
  IconFuel,
  IconReceipt,
  IconDoc,
  IconChart,
  IconUsers,
  IconSettings,
  IconPlus,
  IconGauge,
} from './Icons.js'

interface NavItem {
  to: string
  label: string
  icon: (p: { className?: string }) => ReactNode
  soon?: boolean
  permission?: Permission
}
const SECTIONS: Array<{ title?: string; items: NavItem[] }> = [
  { items: [{ to: '/', label: copy.overview, icon: IconOverview }] },
  {
    title: copy.garage,
    items: [
      { to: '/vehicles', label: copy.vehicles, icon: IconCar },
      { to: '/service', label: copy.service, icon: IconWrench },
      { to: '/maintenance', label: copy.maintenance, icon: IconGauge },
      { to: '/reminders', label: copy.reminders, icon: IconBell },
    ],
  },
  {
    title: copy.ownership,
    items: [
      { to: '/fuel', label: copy.fuel, icon: IconFuel, soon: true },
      {
        to: '/expenses',
        label: copy.expenses,
        icon: IconReceipt,
        permission: 'expense:read',
      },
      { to: '/documents', label: copy.documents, icon: IconDoc, permission: 'document:read' },
    ],
  },
  {
    items: [
      {
        to: '/reports',
        label: copy.reports,
        icon: IconChart,
        soon: true,
        permission: 'report:read',
      },
    ],
  },
  {
    title: copy.workspace,
    items: [
      { to: '/members', label: copy.members, icon: IconUsers },
      {
        to: '/settings',
        label: copy.settings,
        icon: IconSettings,
        soon: true,
        permission: 'workspace:update',
      },
    ],
  },
]

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileNavOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])
  return (
    <div className="min-h-dvh bg-surface-base">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-surface-raised p-3 text-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-2"
      >
        {dashboardCopy.skipNavigation}
      </a>
      <TopBar onMenuClick={() => setMobileNavOpen(true)} mobileNavOpen={mobileNavOpen} />
      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 overflow-y-auto border-r border-border-subtle bg-surface-raised px-4 py-6 lg:block">
          <Nav onNavigate={() => undefined} />
        </aside>
        <Dialog
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          title={copy.navigation}
          size="drawer"
        >
          <Nav onNavigate={() => setMobileNavOpen(false)} />
        </Dialog>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-8 lg:pb-12 lg:pt-8"
          key={location.pathname}
        >
          {children}
        </main>
      </div>
      <MobileTabBar onMore={() => setMobileNavOpen(true)} open={mobileNavOpen} />
    </div>
  )
}

function Nav({ onNavigate }: { onNavigate: () => void }) {
  const { workspace } = useSession()
  return (
    <nav aria-label={copy.navigation}>
      {SECTIONS.map((section, index) => {
        const items = section.items.filter(
          (item) => !item.permission || can(workspace.role, item.permission),
        )
        if (!items.length) return null
        return (
          <div key={index} className={cn(index > 0 && 'mt-5')}>
            {section.title && (
              <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-accent-subtle text-accent'
                          : 'text-content-secondary hover:bg-surface-sunken hover:text-content-primary',
                      )
                    }
                  >
                    <item.icon className="size-5 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {item.soon && (
                      <span className="rounded border border-border-default px-1 text-xs text-content-secondary">
                        {copy.soon}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

function TopBar({
  onMenuClick,
  mobileNavOpen,
}: {
  onMenuClick: () => void
  mobileNavOpen: boolean
}) {
  const { session, workspace, setWorkspace, signOut } = useSession()
  const [userOpen, setUserOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 h-16 border-b border-border-subtle bg-surface-raised">
      <div className="mx-auto flex h-full w-full max-w-[1400px] items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={copy.navigation}
          aria-expanded={mobileNavOpen}
          aria-haspopup="dialog"
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-content-secondary hover:bg-surface-sunken lg:hidden"
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="size-5"
            aria-hidden="true"
          >
            <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
          </svg>
        </button>
        <NavLink
          to="/"
          aria-label={copy.brand}
          className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
        >
          <span className="flex size-11 items-center justify-center rounded-md bg-accent text-content-inverse">
            <IconCar className="size-5" />
          </span>
          <span className="hidden sm:inline">{copy.brand}</span>
        </NavLink>
        <div className="min-w-0 flex-1 lg:max-w-64">
          <label htmlFor="active-workspace" className="sr-only">
            {copy.workspace}
          </label>
          <select
            id="active-workspace"
            value={workspace.id}
            onChange={(event) => setWorkspace(event.target.value)}
            className="h-11 w-full min-w-0 truncate rounded-md border border-border-default bg-surface-raised px-2 text-sm font-medium"
            title={workspace.name}
          >
            {session.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden flex-1 lg:block" />
        {can(workspace.role, 'vehicle:create') && (
          <NavLink
            to="/vehicles/new"
            className="hidden h-11 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-content-inverse hover:bg-accent-hover sm:inline-flex"
          >
            <IconPlus className="size-4" />
            {dashboardCopy.add}
          </NavLink>
        )}
        <NotificationCenter />
        <button
          type="button"
          onClick={() => setUserOpen(true)}
          aria-expanded={userOpen}
          aria-haspopup="dialog"
          aria-label={copy.account}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-xs font-semibold text-accent"
        >
          {session.user.displayName.slice(0, 2).toUpperCase()}
        </button>
        <Dialog open={userOpen} onClose={() => setUserOpen(false)} title={copy.account} size="sm">
          <p className="break-words font-medium">{session.user.displayName}</p>
          <p className="mt-1 break-all text-sm text-content-secondary">{session.user.email}</p>
          <Button onClick={() => void signOut()} className="mt-4">
            {copy.signOut}
          </Button>
        </Dialog>
      </div>
    </header>
  )
}

function MobileTabBar({ onMore, open }: { onMore: () => void; open: boolean }) {
  const { workspace } = useSession()
  const items = [
    { to: '/', label: copy.overview, icon: IconOverview },
    { to: '/vehicles', label: copy.vehicles, icon: IconCar },
    ...(can(workspace.role, 'vehicle:create')
      ? [{ to: '/vehicles/new', label: copy.add, icon: IconPlus }]
      : []),
    { to: '/reminders', label: copy.reminders, icon: IconBell },
  ]
  return (
    <nav
      aria-label={copy.primary}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface-raised lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="flex">
        {items.map((item) => (
          <li key={item.to} className="flex-1">
            <NavLink
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium',
                  isActive ? 'text-accent' : 'text-content-secondary',
                )
              }
            >
              <item.icon className="size-5" />
              {item.label}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button
            type="button"
            onClick={onMore}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-content-secondary"
          >
            <IconSettings className="size-5" />
            {copy.more}
          </button>
        </li>
      </ul>
    </nav>
  )
}
