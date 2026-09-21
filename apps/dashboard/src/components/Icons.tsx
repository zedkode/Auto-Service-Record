/** Inline icons: no icon-font download, no external request, correct in both themes. */
const base = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const IconOverview = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M3 10.5 10 4l7 6.5" />
    <path d="M5 9.5V16h10V9.5" />
  </svg>
)
export const IconCar = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M3 12.5h14" />
    <path d="M5 12.5v1.8a.8.8 0 0 0 .8.8h1.2a.8.8 0 0 0 .8-.8v-1.8" />
    <path d="M12.2 12.5v1.8a.8.8 0 0 0 .8.8h1.2a.8.8 0 0 0 .8-.8v-1.8" />
    <path d="M3.8 12.2 5.3 7.8A1.6 1.6 0 0 1 6.8 6.7h6.4a1.6 1.6 0 0 1 1.5 1.1l1.5 4.4" />
  </svg>
)
export const IconWrench = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M13.5 3.5a3.8 3.8 0 0 0-4.8 4.8l-5 5a1.4 1.4 0 0 0 2 2l5-5a3.8 3.8 0 0 0 4.8-4.8l-2.2 2.2-1.8-1.8Z" />
  </svg>
)
export const IconBell = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M10 3a4 4 0 0 0-4 4c0 3.5-1.2 4.5-1.2 4.5h10.4S14 10.5 14 7a4 4 0 0 0-4-4Z" />
    <path d="M8.5 14a1.6 1.6 0 0 0 3 0" />
  </svg>
)
export const IconFuel = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M4 16V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11" />
    <path d="M3 16h8" />
    <path d="M10 8h2.5a1 1 0 0 1 1 1v4a1.2 1.2 0 0 0 2.4 0V7.5L14 5.8" />
  </svg>
)
export const IconReceipt = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M5 3.5h10v13l-2-1.3-1.7 1.3L10 15.2 8.3 16.5 6.6 15.2 5 16.5Z" />
    <path d="M7.5 7.5h5M7.5 10.5h5" />
  </svg>
)
export const IconDoc = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M6 3h5l4 4v10H6Z" />
    <path d="M11 3v4h4" />
  </svg>
)
export const IconChart = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M4 16V9M8.6 16V5M13.2 16v-4.5M17 16V7.5" />
  </svg>
)
export const IconUsers = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="7.5" r="2.5" />
    <path d="M3.5 16c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6" />
    <path d="M13.5 6.2a2.3 2.3 0 0 1 0 4.4M14.5 12.8c1.4.5 2.3 1.6 2.3 3.2" />
  </svg>
)
export const IconSettings = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 3.2v1.6M10 15.2v1.6M16.8 10h-1.6M4.8 10H3.2M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2" />
  </svg>
)
export const IconPlus = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M10 5v10M5 10h10" />
  </svg>
)
export const IconGauge = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="M4 14a6.5 6.5 0 1 1 12 0" />
    <path d="m10 11 3-3" />
    <circle cx="10" cy="11.6" r="1" />
  </svg>
)
export const IconChevron = (p: { className?: string }) => (
  <svg {...base} {...p}>
    <path d="m7.5 4.5 5 5.5-5 5.5" />
  </svg>
)
