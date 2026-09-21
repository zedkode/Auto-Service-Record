# UI_UX.md — Design System & Interface Guidelines

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20
**Implementation:** `packages/ui` · **Styling:** Tailwind CSS 4 · **Primitives:** Radix UI

---

## 1. Design principles

1. **Information first.** This is a tool for knowing things. Data density beats
   decoration; a vehicle card should tell you the state of the vehicle at a glance.
2. **Status is the product.** Healthy / due soon / attention / overdue must be legible in
   half a second, from across a room, and without relying on colour alone.
3. **One system, not twenty pages.** Every screen is assembled from the same primitives
   with the same spacing scale. Pages built independently look built independently.
4. **Calm by default.** Colour is reserved for meaning. A screen where everything is
   highlighted highlights nothing.
5. **Respect the user's context.** Their units, their currency, their timezone, their
   language, on every screen.
6. **Honest empty states.** An empty state explains what goes here and offers the one
   action that fills it — never a shrugging illustration.

### What we are not building

Generic Bootstrap-looking dashboards. Giant empty cards with a number and nothing else.
Gradients as decoration. Animation that delays information. Inconsistent form layouts.
Decorative graphics that carry no meaning.

---

## 2. Design tokens

Defined once in `packages/ui/src/tokens/` and consumed via Tailwind 4's `@theme`. No app
declares its own colours or spacing.

### 2.1 Colour

Semantic names only. A component never references `blue-600`; it references
`--color-accent`.

```text
Surface        --surface-base        page background
               --surface-raised      cards, panels
               --surface-sunken      wells, code, table headers
               --surface-overlay     dialogs, popovers

Content        --content-primary     headings, primary text
               --content-secondary   supporting text
               --content-tertiary    metadata, timestamps
               --content-inverse     text on solid accent

Border         --border-subtle       dividers
               --border-default      inputs, cards
               --border-strong       focus-adjacent, emphasis

Accent         --accent              primary actions, links
               --accent-hover / --accent-active / --accent-subtle

Status         --status-healthy      OK
               --status-due-soon     approaching
               --status-attention    needs action
               --status-overdue      past due
               --status-neutral      unknown / not tracked
               each with -subtle (background) and -strong (text/icon) variants
```

**Status colours are never the only signal.** Every status pairs a colour with an icon and
a text label. Roughly 1 in 12 men has some form of colour-vision deficiency, and a fleet
manager who cannot distinguish "due soon" from "overdue" is the user we failed.

Light and dark themes are both first-class. Dark mode is a token remapping, not a second
stylesheet.

### 2.2 Spacing

A 4 px base scale: `0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 20, 24` (× 4 px).
Nothing uses an arbitrary pixel value. Component padding, stack gaps and section rhythm
all come from this scale.

### 2.3 Typography

System font stack — fast, familiar, no web-font layout shift, no privacy-leaking CDN.
Tabular numerals (`font-variant-numeric: tabular-nums`) everywhere numbers align in
columns: mileage, money, dates in tables.

```text
display    32/40  600    page hero (marketing only)
h1         24/32  600    page title
h2         20/28  600    section
h3         16/24  600    card title
body       14/20  400    default
body-lg    16/24  400    prose
label      13/16  500    form labels, table headers
caption    12/16  400    metadata, help text
mono       13/20  400    VIN, registration, part numbers, IDs
```

### 2.4 Radius, elevation, motion

Radius: `sm 4px`, `md 6px`, `lg 8px`, `xl 12px`, `full 9999px`. Cards `lg`, inputs `md`,
badges `full`.

Elevation: four levels, from a 1 px border at rest to a real shadow for overlays. Cards
are delineated by border and surface colour, not by drop shadows — stacked shadows are
what make a dashboard look like a template.

Motion: `fast 120ms` (hover, focus), `base 200ms` (dropdowns, accordions), `slow 320ms`
(dialogs, drawers). Easing `cubic-bezier(0.2, 0, 0, 1)`. Everything respects
`prefers-reduced-motion: reduce`, which disables transforms and keeps opacity only.
Nothing animates that delays reading a value.

---

## 3. Component inventory

`packages/ui` ships in three layers.

**Primitives** (Radix-based, unstyled behaviour + our tokens): Button, IconButton, Input,
Textarea, Select, Combobox, DatePicker, Checkbox, Radio, Switch, Slider, Label,
FormField, Dialog, Drawer, Popover, Tooltip, DropdownMenu, Tabs, Accordion, Toast,
Progress, Avatar, Badge, Separator, ScrollArea, Skeleton.

**Patterns** (composed, opinionated): PageHeader, Card, StatCard, DataTable (sorting,
selection, column visibility, sticky header), FilterBar, Pagination, EmptyState,
ErrorState, LoadingState, ConfirmDialog, FormLayout, DetailList, Timeline, StatusBadge,
FileUpload, SearchInput, CurrencyInput, DistanceInput, DateRangePicker.

**Domain** (dashboard-specific, still in `packages/ui` where reusable): VehicleCard,
VehicleStatusIndicator, MaintenanceRuleRow, AttentionItem, ServiceRecordRow,
OdometerWidget, CostBreakdownChart, FuelEconomyChart, DocumentTile, ReminderCard,
NotificationItem.

Rule: a component that appears on two screens belongs in `packages/ui`. A component that
knows about data fetching does not.

---

## 4. Layout

### 4.1 Dashboard shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ▣ AutoServices   [Workspace ▾]        ⌕ Search   🔔 3   [A ▾] │  64px
├──────────┬───────────────────────────────────────────────────┤
│          │                                                   │
│ Overview │  Page header: title, description, actions          │
│          │  ───────────────────────────────────────────────  │
│ GARAGE   │                                                   │
│ Vehicles │  Content, max-width 1280px, 24px gutters           │
│ Service  │                                                   │
│ Mainten. │                                                   │
│ Reminders│                                                   │
│          │                                                   │
│ OWNERSHIP│                                                   │
│ Fuel     │                                                   │
│ Expenses │                                                   │
│ Documents│                                                   │
│          │                                                   │
│ Reports  │                                                   │
│          │                                                   │
│ WORKSPACE│                                                   │
│ Members  │                                                   │
│ Settings │                                                   │
│  240px   │                                                   │
└──────────┴───────────────────────────────────────────────────┘
```

The workspace switcher sits top-left, always visible. Knowing which tenant you are
looking at is a safety property, not a convenience — a fleet manager entering a service
against the wrong workspace is a data-integrity incident.

### Dashboard redesign — 2026-09-20 (UI-003)

The existing dashboard now uses a 64 px header, a raised 240 px desktop navigation
surface, 44 px navigation targets and a keyboard skip link to the main content.
The overview uses a stable page title, prioritises attention items, and renders statistics
from the API. Empty garages omit stat tiles and show the add-vehicle continuation.
At desktop widths, the vehicle grid occupies two thirds of the content area and recent
activity occupies the remaining third; smaller screens stack both sections. Vehicle
placeholders use a compact 2:1 neutral silhouette. No photography or external fonts load.
Overview copy is centralised in `apps/dashboard/src/lib/dashboard-copy.ts`.
Dashboard fetch failures show a retry action and request reference instead of permanent
skeletons. Recent activity has an explicit empty state. Existing server contracts and
status calculations remain authoritative.

### 4.2 Breakpoints

| Token | Width | Layout |
| --- | --- | --- |
| `sm` | ≥ 640 px | Single column, bottom tab bar, drawer navigation |
| `md` | ≥ 768 px | Two-column forms, collapsible sidebar |
| `lg` | ≥ 1024 px | Persistent sidebar, multi-column dashboard |
| `xl` | ≥ 1280 px | Max content width, wider tables |

Below `lg` the sidebar becomes a drawer and the five most-used destinations move to a
bottom tab bar: Overview, Vehicles, Add (+), Reminders, More.

**360 px is the floor.** Every screen must be usable there. Tables become stacked cards
below `md` — horizontal scrolling a data table on a phone is a failure, not a fallback.

---

## 5. Key screens

### 5.1 Overview (dashboard home)

```text
┌─ Attention Required ─────────────────────────────────────────┐
│  🔴  Ford Mondeo · Oil service due in 620 miles      [View]   │
│  🟠  BMW 530d · MOT expires in 14 days               [View]   │
│  🟠  Van 2 · Insurance expires in 7 days             [View]   │
└──────────────────────────────────────────────────────────────┘

┌ Vehicles ─┐ ┌ Due soon ─┐ ┌ Overdue ──┐ ┌ This month ┐
│     3     │ │     2     │ │     1     │ │  £427.50   │
└───────────┘ └───────────┘ └───────────┘ └────────────┘

┌─ Your vehicles ──────────────────────────────────────────────┐
│  [VehicleCard]   [VehicleCard]   [VehicleCard]               │
└──────────────────────────────────────────────────────────────┘

┌─ Recent activity ────────────┐  ┌─ Latest documents ────────┐
│  timeline of recent events   │  │  document tiles           │
└──────────────────────────────┘  └───────────────────────────┘
```

**Attention Required sits above everything.** If nothing needs attention, the section is
replaced by a single quiet confirmation line — not hidden, because its absence is itself
information. Stat tiles are never placeholders: with one vehicle and no data, the overview
shows the onboarding continuation instead.

### 5.2 Vehicle card

```text
┌────────────────────────────────┐
│ [    vehicle photo 16:9     ]  │
│                                │
│ Ford Mondeo 2.0 TDCi           │
│ AB12 CDE · 2016                │
│                                │
│ 150,240 miles                  │
│ ──────────────────────────     │
│ ⚠ Oil service in 620 mi        │
│ ✓ MOT valid until Mar 2027     │
└────────────────────────────────┘
```

Shows, without a click: image (or a neutral silhouette placeholder — not a stock photo),
registration, make/model/year, current mileage, maintenance state, inspection state. The
border-left colour reflects the worst status among its items.

### 5.3 Vehicle detail

Tabs: Overview · Timeline · Service · Maintenance · Mileage · Fuel · Expenses · Tyres ·
Inspection/MOT · Insurance · Tax · Warranty · Documents · Photos · Reminders · Activity ·
Settings.

Tabs are URL-addressable (`/vehicles/:id/service`) so they are linkable, refreshable and
back-button-correct. On mobile the tab bar scrolls horizontally with the active tab
scrolled into view. Tabs with no data show their empty state, not an empty grid — and
low-value tabs are hidden behind "More" rather than presented as seventeen equal choices.

### 5.4 Timeline

```text
│  150,240 mi   ●  Oil + oil filter                £129.00
│  12 Sep 2026  │  Smith & Sons Garage
│               │
│  148,900 mi   ●  Fuel · 52.3 L · full tank        £71.14
│  02 Sep 2026  │  47.2 mpg
│               │
│  147,900 mi   ●  MOT passed · 2 advisories
│  14 Jul 2026  │  Expires 13 Jul 2027
```

One reverse-chronological stream, mileage and date in a fixed left rail, event type as a
coloured node, amount right-aligned with tabular numerals. Filterable by event type.
Cursor-paginated with "load older" rather than numbered pages.

### 5.5 Forms

Single column, labels above inputs, help text below the label, errors below the input.
Required fields marked on the label, not with a bare asterisk in a legend. Related fields
grouped in sections with a heading. Destructive actions are separated and confirmed by
typing the resource name.

The "add service" form is the most-used form in the product: it defaults the date to
today, prefills the odometer from the last known reading, remembers the last workshop
used, and lets a user log a simple oil change in four fields with everything else
collapsed behind "More details".

---

## 6. Status vocabulary

| Status | Colour | Icon | Label | Meaning |
| --- | --- | --- | --- | --- |
| Healthy | `--status-healthy` | ✓ | "Up to date" | Nothing due |
| Due soon | `--status-due-soon` | ◷ | "Due soon" | Within threshold |
| Attention | `--status-attention` | ⚠ | "Needs attention" | Due now |
| Overdue | `--status-overdue` | ✕ | "Overdue" | Past due |
| Unknown | `--status-neutral` | ? | "Not tracked" | No data |

"Not tracked" is deliberately distinct from "healthy". A vehicle with no insurance record
is not insured-and-fine; it is unknown, and the UI says so and offers to fix it.

---

## 7. Content and copy

- **Specific over generic.** "Oil service due in 620 miles" not "Maintenance due".
- **Plain language.** "When does your insurance run out?" not "Policy expiry datetime".
- **UK/local terminology at the surface.** The user sees "MOT"; the database says
  `vehicle_inspection`. Terminology is a locale lookup keyed by country, not a hardcoded
  string.
- **Errors say what to do.** "That mileage is lower than your last reading of 150,240 mi.
  Check the number, or record it as a correction." not "Validation error".
- **Numbers formatted for humans.** `150,240 miles`, `£1,247.50`, `47.2 mpg`,
  `12 Sep 2026`. Locale-aware via `Intl`, never hand-rolled.
- **No string literals in JSX.** All user-facing copy goes through the message catalogue
  from day one, even while English is the only locale. Retrofitting i18n across 200
  components is the expensive way to do this.

---

## 8. Accessibility

Target: **WCAG 2.2 AA** for all dashboard core flows.

- Semantic HTML first. A `<button>` is a button; a `<div onClick>` is a bug.
- Every interactive element reachable and operable by keyboard, in a logical order.
- Visible focus indicators, never `outline: none` without a replacement.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries.
- Every input has a programmatically associated `<label>`. Placeholders are not labels.
- Errors announced via `aria-live`, associated with their field via `aria-describedby`.
- Dialogs trap focus, close on Escape, restore focus to the trigger, and are labelled.
- Tables use `<th>` with `scope`, and a caption or accessible name.
- Icon-only buttons carry an accessible name.
- Status is never conveyed by colour alone (§2.1).
- Touch targets ≥ 44 × 44 px.
- `axe-core` runs in Playwright against key screens; new violations fail CI.

---

## 9. Loading, empty and error states

Every data view specifies all four states. A component that renders only the happy path
is incomplete and fails the Definition of Done.

- **Loading:** skeletons matching the real layout's shape. Not spinners, which say
  nothing about what is coming. Optimistic updates for quick mutations.
- **Empty (no data yet):** a one-line explanation of what belongs here and one primary
  action. "No services recorded yet. Add your first service to start building this
  vehicle's history." + `[Add service]`.
- **Empty (filtered to nothing):** distinct from the above — "No services match these
  filters" + `[Clear filters]`. Telling a user with 200 records that they have no records
  is a bug.
- **Error:** what failed, whether it is retryable, a retry action, and the request ID for
  support. Never a raw stack trace or error object.

---

## 10. Marketing site

Different job, same system. Wider type scale, generous vertical rhythm, real screenshots
of the actual product.

Required pages: Home, Features (+ dedicated pages for Vehicle Management, Maintenance
Tracking, Service History, Reminders, Document Storage, Costs & Reports), Pricing,
Security, FAQ, Contact, Login, Register, Privacy Policy, Terms, Cookie Policy.

Homepage: hero with the value proposition and a primary CTA ("Add your first vehicle") and
secondary ("See how it works") → feature overview → how it works (4 steps) → screenshots →
use cases (personal / family / business / fleet) → pricing summary → security → FAQ →
final CTA.

**SEO requirements:** server-rendered or statically generated HTML (a client-rendered
marketing site is an SEO own goal); per-page `<title>` and meta description; OpenGraph
and Twitter card tags; canonical URLs; `sitemap.xml`; `robots.txt`; JSON-LD structured
data (`SoftwareApplication`, `FAQPage`, `Organization`, `BreadcrumbList`); semantic
heading hierarchy with exactly one `<h1>`; descriptive alt text; Lighthouse ≥ 95 on
performance, accessibility, best practices and SEO.

**Performance budget:** LCP < 2.0 s, CLS < 0.1, no render-blocking third-party scripts,
no web fonts, images as WebP/AVIF with explicit dimensions.

---

## 11. PWA

Planned, not MVP. The architecture accommodates it: the dashboard is a client-rendered
SPA against a stateless JSON API, assets are hashed and cacheable, and the layout is
already mobile-first.

When it ships: web app manifest, service worker caching the shell and last-viewed vehicle
data, an offline banner, an "add to home screen" prompt, and a queued-write path for
odometer and fuel entries made without a connection — those are exactly the entries
people make standing at a petrol pump with one bar of signal.


### Shell interactions — UI-004

Workspace selection uses a labelled native select, retaining keyboard navigation and
current workspace visibility at 360 px. Selection is reactive React state; localStorage
only persists the preference. Storage denial cannot prevent switching workspaces.
Mobile navigation uses the shared native Dialog in drawer mode with Escape, background
inertness and focus restoration. More opens the drawer; a desktop breakpoint closes it.
Account actions use the same Dialog. Each dialog has its own generated accessible title ID.
Native tab navigation may visit browser chrome but does not focus background page controls.

The shell, Overview and vehicle list use `@autoservices/permissions` to hide vehicle-create
entry points for VIEWER/DRIVER. Read-only empty states explain who can add vehicles.
Expenses/reports/settings navigation follows the existing permission matrix. These are
presentation checks; API guards remain authoritative and direct-route authorisation is
not implemented by hiding links. Full UI-002 and WS-002 completion remain separate work.
