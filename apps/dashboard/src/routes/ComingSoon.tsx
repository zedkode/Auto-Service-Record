import { Card, EmptyState } from '@autoservices/ui'
import { PageHeader } from '../components/PageHeader.js'

/**
 * An honest placeholder. The navigation is real and the route resolves, but the page
 * says plainly what is not built yet and when it is planned — rather than presenting a
 * dead button or an empty grid (task brief §15, UI_UX.md §9).
 */
export function ComingSoonPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PageHeader title={title} description={`Planned for ${phase}.`} />
      <Card>
        <EmptyState
          title={`${title} is not built yet`}
          description={`This module is scheduled for ${phase} of the roadmap. The navigation and routing are in place so the structure is real, but there is nothing to show here until the backend for it exists.`}
          icon={
            <svg
              viewBox="0 0 24 24"
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 1.8" strokeLinecap="round" />
            </svg>
          }
        />
      </Card>
    </>
  )
}
