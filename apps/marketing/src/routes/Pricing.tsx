import { Section, SectionHeading } from '../components/SiteLayout.js'
import { APP_URL } from '../config.js'
import { cn } from '@autoservices/ui'

const PLANS = [
  {
    name: 'Free',
    price: '£0',
    period: 'forever',
    description: 'For a single driver getting started.',
    features: [
      '1 workspace',
      '2 vehicles',
      'Service history',
      'Basic reminders',
      '100 MB documents',
    ],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Pro',
    price: '£4',
    period: 'per month',
    description: 'For enthusiasts with a few vehicles.',
    features: [
      '3 workspaces',
      '10 vehicles',
      '3 members',
      'Advanced reports',
      'Exports',
      '5 GB documents',
    ],
    cta: 'Choose Pro',
    featured: true,
  },
  {
    name: 'Family',
    price: '£7',
    period: 'per month',
    description: 'One shared garage for the household.',
    features: [
      'Shared workspace',
      '8 vehicles',
      '6 members',
      'Per-member reminders',
      '5 GB documents',
    ],
    cta: 'Choose Family',
    featured: false,
  },
  {
    name: 'Business',
    price: '£29',
    period: 'per month',
    description: 'For companies running a fleet.',
    features: [
      '5 workspaces',
      '100 vehicles',
      '25 members',
      'Driver accounts',
      'Fleet reporting',
      'API access',
    ],
    cta: 'Talk to us',
    featured: false,
  },
]

export function PricingPage() {
  return (
    <>
      <Section className="pb-6 pt-14">
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Upgrade when you need more."
          description="Billing is not switched on yet — every plan is currently available at no cost while the platform is in development."
        />
      </Section>

      <Section className="pt-4">
        <div className="grid gap-5 lg:grid-cols-4">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cn(
                'relative flex flex-col rounded-xl border bg-surface-raised p-6',
                p.featured ? 'border-accent shadow-md' : 'border-border-subtle',
              )}
            >
              {p.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-[16px] font-semibold">{p.name}</h3>
              <p className="mt-1 text-[13px] text-content-secondary">{p.description}</p>
              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] font-semibold tracking-tight">{p.price}</span>
                <span className="text-[13px] text-content-tertiary">{p.period}</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                    <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] text-accent">
                      ✓
                    </span>
                    <span className="text-content-secondary">{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`${APP_URL}/sign-in`}
                className={cn(
                  'mt-6 inline-flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-medium transition-colors',
                  p.featured
                    ? 'bg-accent text-white hover:bg-accent-hover'
                    : 'border border-border-default hover:bg-surface-sunken',
                )}
              >
                {p.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-[13px] text-content-tertiary">
          Prices are indicative while the platform is in development. Limits are enforced by the
          server, not the interface.
        </p>
      </Section>
    </>
  )
}
