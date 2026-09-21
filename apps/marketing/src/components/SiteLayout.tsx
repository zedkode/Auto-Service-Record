import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router'
import { cn } from '@autoservices/ui'
import { APP_URL } from '../config.js'

const NAV = [
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/security', label: 'Security' },
]

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
        <svg
          viewBox="0 0 20 20"
          className="size-[18px]"
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
      <span className="text-[16px]">AutoServices</span>
    </span>
  )
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col bg-surface-base">
      <header className="sticky top-0 z-50 border-b border-border-subtle bg-surface-raised/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="AutoServices home">
            <Logo />
          </Link>

          <nav aria-label="Main" className="hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors',
                    isActive ? 'text-accent' : 'text-content-secondary hover:text-content-primary',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          <div className="hidden items-center gap-2 md:flex">
            <a
              href={`${APP_URL}/sign-in`}
              className="rounded-md px-3 py-1.5 text-[14px] font-medium text-content-secondary hover:text-content-primary"
            >
              Log in
            </a>
            <a
              href={`${APP_URL}/sign-in`}
              className="rounded-md bg-accent px-3.5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Get started
            </a>
          </div>

          <button
            type="button"
            className="-mr-1 flex size-9 items-center justify-center rounded-md text-content-secondary hover:bg-surface-sunken md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M3.5 6h13M3.5 10h13M3.5 14h13" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {open && (
          <div className="border-t border-border-subtle bg-surface-raised px-4 py-3 md:hidden">
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-[14px] font-medium text-content-secondary hover:bg-surface-sunken"
                >
                  {n.label}
                </NavLink>
              ))}
              <a
                href={`${APP_URL}/sign-in`}
                className="mt-1 rounded-md bg-accent px-3 py-2 text-center text-[14px] font-medium text-white"
              >
                Get started
              </a>
            </nav>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border-subtle bg-surface-raised">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Logo />
              <p className="mt-3 max-w-xs text-[13.5px] text-content-secondary">
                The complete history of every vehicle you own — and a reminder before anything
                expires.
              </p>
            </div>
            <FooterCol
              title="Product"
              links={[
                ['Features', '/features'],
                ['Pricing', '/pricing'],
                ['Security', '/security'],
              ]}
            />
            <FooterCol
              title="Company"
              links={[
                ['About', '/'],
                ['Contact', '/'],
                ['Blog', '/'],
              ]}
            />
            <FooterCol
              title="Legal"
              links={[
                ['Privacy', '/'],
                ['Terms', '/'],
                ['Cookies', '/'],
              ]}
            />
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-border-subtle pt-6 text-[12.5px] text-content-tertiary sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} AutoServices. All rights reserved.</p>
            <p>Made for people who keep their receipts.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-content-tertiary">
        {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {links.map(([label, to]) => (
          <li key={label}>
            <Link to={to} className="text-[13.5px] text-content-secondary hover:text-accent">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section
      id={id}
      className={cn('mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20', className)}
    >
      {children}
    </section>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  centered = true,
}: {
  eyebrow?: string
  title: string
  description?: string
  centered?: boolean
}) {
  return (
    <div className={cn('max-w-2xl', centered && 'mx-auto text-center')}>
      {eyebrow && (
        <p className="mb-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-accent">
          {eyebrow}
        </p>
      )}
      <h2 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[32px]">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-[15px] leading-relaxed text-content-secondary">{description}</p>
      )}
    </div>
  )
}
