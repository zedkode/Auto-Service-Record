import { Link } from 'react-router'
import { Section, SectionHeading } from '../components/SiteLayout.js'
import { APP_URL } from '../config.js'
import { DashboardPreview } from '../components/DashboardPreview.js'

export function HomePage() {
  return (
    <>
      {/* Hero */}
      <Section className="pb-8 pt-14 sm:pb-10 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-raised px-3 py-1 text-[12.5px] font-medium text-content-secondary">
            <span className="size-1.5 rounded-full bg-status-healthy" aria-hidden="true" />
            For drivers, families, businesses and fleets
          </p>
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
            Know exactly what your <span className="text-accent">vehicle needs</span>, before
            it&rsquo;s a problem
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-content-secondary sm:text-[17px]">
            Every service, every part, every MOT, every renewal and every pound spent — kept in one
            place, for every vehicle you own. We tell you what&rsquo;s due before it&rsquo;s
            overdue.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href={`${APP_URL}/sign-in`}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover sm:w-auto"
            >
              Add your first vehicle
            </a>
            <a
              href="#how-it-works"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border-default bg-surface-raised px-6 text-[15px] font-medium transition-colors hover:bg-surface-sunken sm:w-auto"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-[13px] text-content-tertiary">
            Free for your first two vehicles. No card required.
          </p>
        </div>

        <div className="mt-14">
          <DashboardPreview />
        </div>
      </Section>

      {/* Problem */}
      <Section className="py-14">
        <SectionHeading
          eyebrow="The problem"
          title="Vehicle history lives in a shoebox"
          description="Receipts fade. Service books get lost. The garage that did the timing belt closed down. And the only person who knows when the insurance renews is the person who bought it."
        />
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-3">
          {[
            { stat: 'Missed services', detail: 'Premature failure of expensive components.' },
            { stat: 'Lapsed renewals', detail: 'Fines, invalid insurance, an undriveable car.' },
            { stat: 'Unprovable history', detail: 'Measurably lower resale value.' },
          ].map((c) => (
            <div
              key={c.stat}
              className="rounded-xl border border-border-subtle bg-surface-raised p-5"
            >
              <p className="text-[15px] font-semibold text-content-primary">{c.stat}</p>
              <p className="mt-1.5 text-[13.5px] text-content-secondary">{c.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Features */}
      <Section id="features">
        <SectionHeading eyebrow="What you get" title="Everything about the vehicle, in one place" />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-border-subtle bg-surface-raised p-5 transition-colors hover:border-border-default"
            >
              <div className="mb-3.5 flex size-9 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                {f.icon}
              </div>
              <h3 className="text-[15px] font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-content-secondary">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" className="border-y border-border-subtle bg-surface-raised">
        <SectionHeading eyebrow="How it works" title="Set up in about four minutes" />
        <ol className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Create your account', 'You get a personal garage automatically.'],
            ['Add your vehicle', 'Make and model is enough to start. Add the rest whenever.'],
            ['Record the mileage', 'Everything else is calculated from it.'],
            ['Get reminded', 'Before a service, MOT, insurance or tax is due.'],
          ].map(([title, body], i) => (
            <li key={title} className="relative">
              <span className="flex size-8 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
                {i + 1}
              </span>
              <h3 className="mt-3.5 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-content-secondary">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* Use cases */}
      <Section>
        <SectionHeading
          eyebrow="Who it's for"
          title="One vehicle or one hundred"
          description="A workspace can be your own garage, your family's, or your company's. The product doesn't change shape — only who's in it."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Drivers', 'Keep a provable history and stop discovering the MOT expired yesterday.'],
            ['Families', 'One shared garage. Everyone sees what is due; anyone can log a fill-up.'],
            ['Businesses', 'Vans, cars and drivers, with roles that keep financials private.'],
            ['Fleets', 'Compliance tracking and cost-per-mile across every vehicle you run.'],
          ].map(([title, body]) => (
            <div
              key={title}
              className="rounded-xl border border-border-subtle bg-surface-raised p-5"
            >
              <h3 className="text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-content-secondary">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Reminders spotlight */}
      <Section className="border-y border-border-subtle bg-surface-raised">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Reminders"
              title="It tells you before, not after"
              description="Reminders work on time and on distance — whichever comes first. An oil service due every 10,000 miles warns you at 9,500, not when you remember to check."
              centered={false}
            />
            <ul className="mt-6 space-y-3">
              {[
                'Service due by date or by mileage',
                'MOT, insurance and road tax expiry',
                'Sent at 9am in your timezone, never at 3am',
                'In-app and email, with per-category control',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[14px]">
                  <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-status-healthy-subtle text-[11px] text-status-healthy">
                    ✓
                  </span>
                  <span className="text-content-secondary">{t}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border-subtle bg-surface-base p-5 shadow-sm">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-content-tertiary">
              Attention required
            </p>
            <ul className="space-y-2.5">
              {[
                ['Ford Mondeo', 'Oil service due in 620 miles', 'attention'],
                ['BMW 530d', 'MOT expires in 14 days', 'due-soon'],
                ['Van 2', 'Insurance expires in 7 days', 'overdue'],
              ].map(([v, msg, sev]) => (
                <li
                  key={v}
                  className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3.5 py-2.5"
                >
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      sev === 'overdue'
                        ? 'bg-status-overdue'
                        : sev === 'attention'
                          ? 'bg-status-attention'
                          : 'bg-status-due-soon'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">{v}</p>
                    <p className="text-[12.5px] text-content-secondary">{msg}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Final CTA */}
      <Section className="text-center">
        <SectionHeading
          title="Start with one vehicle"
          description="Add it in a minute. Build its history from there."
        />
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={`${APP_URL}/sign-in`}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover sm:w-auto"
          >
            Add your first vehicle
          </a>
          <Link
            to="/pricing"
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border-default bg-surface-raised px-6 text-[15px] font-medium hover:bg-surface-sunken sm:w-auto"
          >
            See pricing
          </Link>
        </div>
      </Section>
    </>
  )
}

const ico = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'size-[18px]',
  'aria-hidden': true,
}

const FEATURES = [
  {
    title: 'Complete service history',
    body: 'What was done, when, at what mileage, by whom, for how much — with the parts that went in and the invoice attached.',
    icon: (
      <svg {...ico}>
        <path d="M13.5 3.5a3.8 3.8 0 0 0-4.8 4.8l-5 5a1.4 1.4 0 0 0 2 2l5-5a3.8 3.8 0 0 0 4.8-4.8l-2.2 2.2-1.8-1.8Z" />
      </svg>
    ),
  },
  {
    title: 'Maintenance that calculates itself',
    body: 'Intervals by time, distance, or whichever comes first. The server works out what is due — the numbers are never guessed in your browser.',
    icon: (
      <svg {...ico}>
        <path d="M4 14a6.5 6.5 0 1 1 12 0" />
        <path d="m10 11 3-3" />
        <circle cx="10" cy="11.6" r="1" />
      </svg>
    ),
  },
  {
    title: 'Mileage you can trust',
    body: 'Every reading is kept. Nothing is overwritten. Corrections are recorded as corrections, so the history stays evidence.',
    icon: (
      <svg {...ico}>
        <path d="M3 15V9M8 15V5M13 15v-4M17 15V7" />
      </svg>
    ),
  },
  {
    title: 'Renewals and expiries',
    body: 'MOT, insurance, road tax and warranty — tracked with configurable warnings at 30, 14, 7 and 1 days.',
    icon: (
      <svg {...ico}>
        <path d="M10 3a4 4 0 0 0-4 4c0 3.5-1.2 4.5-1.2 4.5h10.4S14 10.5 14 7a4 4 0 0 0-4-4Z" />
        <path d="M8.5 14a1.6 1.6 0 0 0 3 0" />
      </svg>
    ),
  },
  {
    title: 'Private document vault',
    body: 'Invoices, certificates and policies, stored privately. Every download is permission-checked and links expire in minutes.',
    icon: (
      <svg {...ico}>
        <path d="M6 3h5l4 4v10H6Z" />
        <path d="M11 3v4h4" />
      </svg>
    ),
  },
  {
    title: 'Real cost of ownership',
    body: 'What the vehicle actually costs, per year and per mile, across servicing, fuel, insurance and everything else.',
    icon: (
      <svg {...ico}>
        <path d="M5 3.5h10v13l-2-1.3-1.7 1.3L10 15.2 8.3 16.5 6.6 15.2 5 16.5Z" />
        <path d="M7.5 7.5h5M7.5 10.5h5" />
      </svg>
    ),
  },
]
