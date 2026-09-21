import { Section, SectionHeading } from '../components/SiteLayout.js'
import { APP_URL } from '../config.js'

const GROUPS = [
  {
    title: 'Vehicle management',
    items: [
      'Full specification: engine, gearbox, drivetrain, VIN, registration',
      'Status lifecycle — active, stored, sold, scrapped, archived',
      'History is never destroyed, even when a vehicle is sold',
      'Photos and a private document vault per vehicle',
    ],
  },
  {
    title: 'Service and maintenance',
    items: [
      'Service records with parts, labour, taxes and totals',
      'Structured parts: brand, part number, supplier, warranty',
      'Intervals by time, distance, or whichever comes first',
      'Custom service categories and user-overridable intervals',
    ],
  },
  {
    title: 'Ownership and compliance',
    items: [
      'MOT and inspection records with advisories',
      'Insurance policies, road tax and warranties',
      'Tyre sets with position, tread depth and seasons',
      'Fuel entries with consumption and cost per mile',
    ],
  },
  {
    title: 'Sharing and teams',
    items: [
      'Workspaces for a person, family, business or fleet',
      'Five roles from owner to read-only viewer',
      'Drivers can log mileage and fuel without seeing financials',
      'Strict isolation — one workspace can never see another',
    ],
  },
]

export function FeaturesPage() {
  return (
    <>
      <Section className="pb-8 pt-14">
        <SectionHeading
          eyebrow="Features"
          title="Built for the whole life of the vehicle"
          description="From the day you buy it to the day you sell it, with the paperwork to prove it."
        />
      </Section>

      <Section className="pt-0">
        <div className="grid gap-6 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div
              key={g.title}
              className="rounded-xl border border-border-subtle bg-surface-raised p-6"
            >
              <h3 className="text-[16px] font-semibold">{g.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {g.items.map((i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-[11px] text-accent">
                      ✓
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-content-secondary">
                      {i}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <a
            href={`${APP_URL}/sign-in`}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover"
          >
            Add your first vehicle
          </a>
        </div>
      </Section>
    </>
  )
}
