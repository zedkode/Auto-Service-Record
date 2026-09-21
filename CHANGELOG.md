# CHANGELOG

All notable **product and platform** changes are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**`CHANGELOG.md` records what changed for users and operators. `TASKS.md` records
engineering work.** They are different files and must not be merged. A refactor that
changes no behaviour belongs in `TASKS.md` only.

---

## [Unreleased]

### Added — Share a garage with other people
- **Invite someone by email.** They get a link that works for 7 days, and appears under
  pending invitations until they accept it.
- **Roles you can change.** Admin, editor, driver or viewer — set when you invite someone
  and changeable afterwards.
- **Remove someone, or leave yourself.** Access ends immediately either way.
- **Hand over the garage.** Ownership can be transferred to another member; you become an
  admin in the same moment. It takes a typed confirmation, because only the new owner can
  transfer it back.

### Security
- An invitation only works for the address it was sent to, so forwarding the email does
  not hand over access.
- The invitation link is stored only as a hash — a copy of the database contains no
  usable invitation.
- A used, revoked or expired link is refused in exactly the same way as an invented one.
- The owner cannot be removed, demoted or leave, so a garage is never left without
  somebody responsible for it.
- Every change of membership is recorded in the audit log.

### Security — Staff access to your data is now a deliberate, recorded act
- **Nobody on the support team can open your vehicles or documents by default.** Not even
  the most senior account. There is no permission that grants it.
- **Access requires a written reason, a narrow scope, and an expiry of at most 24 hours**,
  and can be ended at any moment.
- **Every single time that access is used it is recorded** — not just the moment it was
  granted. Attempts made without access are recorded too.
- **Staff can see that a document exists, never read it.** There is no way for the support
  console to open one of your files.
- **The register of who holds access, and why, is visible to the whole team**, including
  the people who cannot request it — so it is something colleagues notice, not something
  one person reviews.

### Security — The operations console now has real authentication
- **Staff sign in with a password and an authenticator code.** Two-factor is mandatory:
  an account that has not finished setting it up cannot sign in at all.
- **The shared secret is gone.** The console previously relied on a key built into the
  browser bundle, which was never an access-control model. It no longer opens anything.
- **Staff and customer accounts are completely separate** — different accounts, different
  sessions, different permissions. A customer login cannot reach the console, and a staff
  login cannot reach customer data through the normal app.
- **Staff sessions last 8 hours** rather than the 30 days a customer session lasts.
- **Roles decide what each person can do** — operations, support, billing and read-only
  each see only what their job needs, and read-only can change nothing.
- **Reading a customer's documents or vehicle content is not possible for any staff role.**
  The audited grant that will make it possible for genuine support cases is not built yet,
  so today the answer is simply no.
- **Every staff action is recorded**, including failed sign-ins, with no passwords or
  codes in the record.

### Added — Keep the paperwork with the car
- **A document vault on every vehicle.** Upload invoices, MOT certificates, registration
  documents and photos, and they stay with the vehicle they belong to.
- **Private by default.** Files are never publicly readable. Opening one creates a link
  that works for five minutes and only for someone who can already see that vehicle.
- **Uploads are checked, not trusted.** A file that is not what it claims to be — an HTML
  page renamed to .pdf, say — is quarantined and never served, and you are told why.
- **A workspace-wide Documents page** listing everything stored across your vehicles.

### Added — See where the money went
- **A workspace Expenses page** with totals for this month or this year, broken down by
  category and by vehicle, and a full list of every cost.

### Changed
- **The sidebar no longer labels Expenses and Documents "Soon"** — both now work.

### Security
- PDFs and images only (PDF, JPEG, PNG, WebP, HEIC), 20 MB per file. SVG is refused
  because it can carry scripts.
- File names never form part of the stored address, so one document cannot be used to
  guess another.
- Uploads and downloads are recorded in the audit log.
- No malware scanner is configured yet, and the platform records that honestly rather than
  marking unscanned files as clean.

### Added — What your vehicle actually costs
- **A cost ledger per vehicle.** A new Expenses tab lists everything a vehicle has cost,
  and you can add costs that do not belong to a service — a car wash, parking, a toll.
- **Service, insurance and tax costs appear by themselves.** Record a service with a total,
  a policy with a premium or a tax payment, and the cost shows up in the ledger without
  being typed twice. Edit the service and the cost follows; delete it and the cost goes.
- **Counted once.** A service that carries its cost into the ledger is never also counted
  separately, so totals cannot quietly double.
- **Costs that came from somewhere else say so**, and are edited at their source rather
  than offering a change that would not stick.

### Changed — The overview now tells you the truth
- **Spend this month is real money**, read from the ledger. It previously always said
  "not tracked", because expenses did not exist.
- **The attention panel includes everything that can demand action** — overdue servicing,
  an expired or expiring MOT, insurance or road tax — not just stale mileage. A vehicle
  with a lapsed MOT previously showed nothing on the overview.
- **Recent activity includes services and inspections**, not only mileage updates.
- **Amounts in different currencies are never added together.** Where a total would mix
  them, the platform says so instead of showing a number that means nothing.
- **A blank amount stays blank.** A service with no total recorded is not treated as a
  free service.

### Added — MOT, insurance and road tax
- **Know whether a vehicle is legal to drive.** A new Ownership tab on each vehicle shows
  its inspection, insurance and road tax together, each with how long is left and a plain
  status rather than a date you have to work out for yourself.
- **Inspection advisories.** Record what the tester warned about but did not fail the
  vehicle for, marked minor, major or dangerous, and tick them off once they are dealt
  with — with the service that fixed one linked to it.
- **Reminders for all three.** An expiring MOT, policy or tax now produces the same
  reminders and emails that maintenance already did, up to 90 days ahead and again once
  overdue. Nothing about the reminder engine had to change to add them.
- **Renewing stops the nagging.** Adding a new certificate or policy silences the reminder
  for the one it replaces, so a vehicle taxed this morning stops being reported as untaxed.
- **Only the current record is chased.** Years of past MOTs stay as history and do not
  each produce their own "expired" reminder.
- **Not UK-only.** Road tax carries a country, and inspections cover MOT, ITP, TÜV, CT,
  state inspection and emissions.
- **Drivers see cover, not costs.** A workspace member with the DRIVER role can see that
  insurance or an MOT has lapsed — they are the one at the wheel — but premiums, excesses
  and tax amounts stay with the roles that already see financial data.

### Added — Email delivery tracking and suppression
- **Delivery history.** Every message is recorded before the provider is called, with its
  status, subject, recipient and correlation id, so a message that never arrives can still
  be explained. Status only ever moves forward, so a delivery event arriving after a bounce
  cannot rewrite the outcome.
- **Provider webhook.** Resend delivery events are ingested over a signature-verified
  endpoint. Forged, tampered, stale and replayed requests are rejected or ignored.
- **Suppression list.** Addresses that permanently bounce or report mail as spam are
  refused before the next send, protecting delivery for everyone else. Transient bounces do
  **not** suppress: a full mailbox clears by itself, and wrongly blocking an address would
  silently stop that owner's MOT and insurance reminders.
- **Account recovery still works after a complaint.** Marking a reminder as spam stops the
  reminders, not password resets or security mail. A dead mailbox blocks everything.
- **Operations console.** New Emails and Suppressions views: filter delivery by status or
  recipient, expand a message to see its provider event history, and release an address
  that was suppressed in error, with the release recorded in the audit log.

### Fixed
- Admin console requests were blocked by CORS because the internal token header was not on
  the allowed list; the operational views showed an error instead of data.

### Changed — Accessible dashboard navigation
- Keyboard-accessible native workspace selector; switching works when browser storage is blocked.
- Mobile More opens a modal navigation drawer; account controls support Escape and focus restoration.
- Vehicle-create entry points respect workspace roles on the shell, overview and vehicle list.
- Drawer closes when switching to desktop layout; dialog title IDs are unique.

### Changed — Dashboard redesign
- Clearer dashboard hierarchy, roomier navigation, keyboard skip link and compact vehicle cards.
- Desktop overview places vehicle cards beside recent activity; mobile stacks the sections.
- Overview failures now offer retry rather than leaving statistics loading indefinitely.
- Empty garages start with the add-vehicle action; empty activity is explained explicitly.
- Removed outdated Phase 4 messaging from maintenance statistics.

### Added — Phase 1 (engineering foundation)
- **Running platform.** Five applications start with `pnpm dev:all` against PostgreSQL 18,
  Redis 8, MinIO and Mailpit in Docker Compose.
- **Accounts.** Registration (creating user, profile, personal workspace and OWNER
  membership in one transaction), login with lockout, logout, session listing. Argon2id
  passwords; session and reset tokens stored only as hashes.
- **Workspaces.** Membership and role resolution, workspace switcher, members list.
- **Vehicles.** Create, list, detail with URL-addressable tabs, and a reusable timeline.
- **Mileage.** Append-only odometer history, derived current reading with staleness
  detection, regression rejection, and an audited correction path.
- **Dashboard.** Attention panel driven by real derived state, stat tiles, recent activity.
- **Marketing site.** Home, Features, Pricing and Security with OpenGraph, canonical URLs,
  JSON-LD, `robots.txt` and `sitemap.xml`.
- **Admin console.** Separate origin and build, live platform health, honest placeholders.
- **Worker.** Six BullMQ queues, repeatable schedulers, graceful shutdown.
- **Email.** `EmailService` with Resend, SMTP and in-memory transports; six templates with
  HTML and hand-written plain text; Redis-backed atomic idempotency.
- **Design system.** Semantic light/dark tokens, primitives, and loading, empty,
  filtered-empty and error states throughout.
- 210 automated tests, including a 22-case tenant isolation suite that blocks merge.

### Fixed
- Email enqueues were failing silently: BullMQ rejects custom job ids containing `:`, and
  the non-fatal catch meant reminder emails were dropped with only a log line.
- A delivery reservation could outlive a failed enqueue, making that reminder window
  permanently unsendable.
- An overdue notification read "Overdue by 23,200 miles ago."
- Reminder grouping was computed during React render, which is impure and duplicated a
  rule the server already owns.
- A migration dropped four trigram indexes that a later migration created, so a fresh
  database could not be built from the migration history.
- The tenant-scoping Prisma extension broke every `update`, `delete` and `findUnique`
  through the scoped client, because it wrapped the `where` clause in `AND`, which Prisma
  rejects for unique lookups.
- Registration failed for the second and subsequent users created in the same short
  window, because workspace slugs were derived from a time-ordered UUIDv7 prefix.
- Recent activity on the dashboard was ordered by row insertion rather than by the date
  the event happened, so back-dated entries appeared in a jumbled order.
- Sign-out left the dashboard showing the previous user's data until a manual refresh.
- Links styled as buttons rendered `<a><button>`, which could swallow the click.
- "1 item need looking at" → "1 item needs looking at".

### Added — authentication (Phase 2)
- **Email verification.** Registration issues a hashed, single-use, 24-hour token and
  queues the email through the worker. Verifying promotes the account to ACTIVE and sends
  a welcome message. Unverified accounts can still sign in, with an in-app prompt to
  confirm and a resend action.
- **Password reset.** Forgotten-password returns an identical response for known and
  unknown addresses. The token is hashed, single-use and expires in an hour; using it
  revokes every session and sends a security alert.
- **Rate limiting** on login (5 per 15 min per account, 20/hour per IP), registration
  (3/hour), password reset and verification resend, returning 429 with `Retry-After`.
- Registration now collects password confirmation and explicit terms acceptance.

### Added — service history and maintenance (Phase 4)
- **Service records** with structured parts, cost breakdown, workshop, category and
  next-service recommendation. Recording a service also writes an odometer reading and
  advances the matching maintenance item — one form, one transaction.
- **25 built-in service categories** with suggested intervals, clearly labelled as common
  practice rather than manufacturer specifications, and fully editable.
- **Maintenance engine** computing OK / DUE_SOON / DUE / OVERDUE from time, distance or
  whichever comes first, entirely server-side, with 32 exhaustive engine tests.
- **Maintenance schedules** per vehicle: start from suggested intervals, mark items done
  (appending to completion history, never overwriting), and edit any interval.
- **Service history UI** with server-side search, category and date filters, a detail view
  showing parts and cost breakdown, and soft delete.
- **Workspace-wide Service and Maintenance pages**, plus real running-cost totals on the
  vehicle overview, grouped by currency and never summed across them.
- **Timeline rebuilt** as one multi-source aggregator covering services, mileage, purchase,
  sale and vehicle creation.

### Added — reminders and notifications (Phase 5)
- **Reminder engine** with pluggable sources. A source finds its own due-dated things;
  the engine owns scheduling, windows, deduplication and delivery. Adding inspections or
  insurance later means registering a source, not changing the engine.
- **Two sources live:** maintenance items that are due or overdue, and vehicles whose
  mileage has gone stale enough to make distance projections unreliable.
- **Reminder policies** with configurable lead windows (30/14/7/1 days, 1000/500 distance),
  weekly rather than daily nagging once overdue, and stable delivery keys.
- **In-app notification centre** in the header, with unread badge, mark-one and
  mark-all-read, and a link through to the item that triggered it.
- **Reminders page** grouping overdue, due soon and upcoming, with snooze, dismiss and
  complete, plus a handled history.
- **Hourly scheduler** in the worker driving the scan, with the engine reachable through
  one internal endpoint so there is a single implementation.
- **Email delivery records** (`email_messages`, `email_delivery_events`) and a delivery
  ledger (`notification_deliveries`) whose unique key makes retries no-ops.
- **Notification preferences** per category and channel, opt-out for reminders and
  opt-in for digests.

### Added — tooling
- `pnpm lint` across the workspace (ESLint 10 flat config, zero warnings tolerated), with
  shared `base` / `node` / `react` presets in `packages/eslint-config`.
- `infrastructure/scripts/reset-dev-data.sh` to clear verification artefacts without
  touching seeded data.

### Security
- Documented security invariants are now **mechanically enforced** and each rule is
  verified to fire: the Resend SDK is confined to its transport, `unscoped()` is confined
  to admin and worker code, `$queryRawUnsafe` is blocked, `dangerouslySetInnerHTML` is
  banned in application code, and apps cannot import from other apps.
- Three-layer tenant isolation: request guard (404 not 403 across tenants), a Prisma
  client extension that scopes every query, and composite `(id, workspace_id)` foreign
  keys enforced by PostgreSQL.
- Log and audit redaction now matches normalised key names, so `API_KEY` and `api-key`
  are caught alongside `apiKey`.
- Email idempotency reserves its key before sending, closing a race that could send the
  same reminder twice.

### Added — Phase 0 (specification)
- Project specification and architecture documentation (Phase 0): `INIT.md`, `PRODUCT.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `API.md`, `SECURITY.md`, `EMAILS.md`, `UI_UX.md`,
  `TESTING.md`, `DEPLOYMENT.md`.
- Agent operating contracts: `AGENTS.md`, `CLAUDE.md`.
- Entity relationship diagram covering ~45 entities across six domain views
  (`docs/database/erd.md`).
- Architecture Decision Records ADR-001 through ADR-010.
- Delivery plan (`ROADMAP.md`), task tracker (`TASKS.md`, 138 tasks), decision log
  (`DECISIONS.md`).
- Monorepo directory skeleton and environment variable catalogue (`.env.example`).

---

## Format

```markdown
## [1.2.0] - 2026-11-15

### Added
- New capability a user can now use.

### Changed
- Existing behaviour that now works differently.

### Deprecated
- Behaviour that still works but will be removed, with the removal target.

### Removed
- Behaviour that no longer exists.

### Fixed
- A bug a user could have noticed.

### Security
- A security-relevant change. Always listed, never omitted for discretion.
```
