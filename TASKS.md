# TASKS.md — Task Tracker

**Status:** Living document · **Updated:** 2026-09-20
**This is the project's central task tracker.** Read it before starting work; update it
after finishing.

---

## How to use this file

**Statuses:** `BACKLOG` · `READY` · `IN_PROGRESS` · `BLOCKED` · `REVIEW` · `DONE`

`PARTIAL` appears only in the compact tables below. It means a usable slice shipped and is
verified, but the task's full acceptance criteria are not met, so it is **not** DONE and
must not be counted as such. Each one lists what shipped and what is missing in
§Partial deliveries.
**Priorities:** `CRITICAL` · `HIGH` · `MEDIUM` · `LOW`

**Rules**

1. Pick the highest-priority `READY` task whose dependencies are all `DONE`.
2. Set it `IN_PROGRESS` **before** writing code.
3. Complete it to the Definition of Done (`AGENTS.md` §6).
4. Set it `DONE` and promote newly-unblocked tasks from `BACKLOG` to `READY`.
5. **Never delete a completed task.** `DONE` tasks are the project's history.
6. Tasks discovered mid-work are added here, not silently absorbed.

**Task detail policy.** Tasks in the current and next phase carry the full block. Tasks in
later phases are listed compactly in §Backlog and are expanded to a full block when they
are promoted to `READY` — specifying a task twelve weeks before it is implemented means
specifying it twice.

---

## Status summary

| Phase | Tasks | DONE | REVIEW | IN_PROGRESS | READY | PARTIAL | BACKLOG |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 — Specification | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| 1 — Foundation | 22 | 20 | 1 | 0 | 0 | 0 | 1 |
| 2 — Auth & tenancy | 21 | 18 | 2 | 1 | 0 | 0 | 0 |
| 3–12 — Later phases | 92 | 42 | 0 | 0 | 0 | 9 | 41 |
| **Total** | **142** | **87** | **3** | **1** | **0** | **9** | **42** |

Phase 1 is complete except `CORE-021` (production Dockerfiles), deliberately deferred —
it is not needed to run locally. `CORE-020` (CI) is now unblocked: `lint`, `typecheck`,
`test` and `build` all exist and pass, so a pipeline has something to run.

Parts of `VEH-001`, `VEH-002`, `VEH-004`, `VEH-007` and `VEH-008` were delivered early to
make a working vertical slice. They stay `BACKLOG` because their full acceptance criteria
(images, archival, soft delete, onboarding) are not met; the shipped subset is listed
under "Verified working" below.

**Phase 7 (documents) is functionally complete** except `DOC-105` (storage accounting
against plan entitlements, which needs the entitlement system) and `DOC-108` (orphan
reaping and retention-based hard deletion). Abandoned `PENDING` rows and their objects
therefore accumulate today — harmless but untidy, and the nightly reaper is the fix.
`VEH-006` (vehicle images through the document pipeline) is now unblocked, as is
`HARD-003` (document pipeline penetration review).

`ADMIN-001` and `ADMIN-002` are `DONE`, and the shared secret that used to gate the
operations console is **gone** — the header no longer opens anything. Staff sign in with a
password and a TOTP code against a separate table, session store, cookie and RBAC matrix.
`SEC-017` (admin 2FA) is satisfied by the same work.

`SEC-018` is `DONE`: staff reach customer content only through a grant with a written
reason, a scope and an expiry of at most 24 hours, and **every use is audited**, not only
the granting.

`SEC-003` is also marked `DONE` — it was built and tested long ago and simply never
recorded. Verification and reset tokens are stored only as SHA-256 hashes, are single-use
via `consumed_at`, and expire; `apps/api/test/integration/auth-flows.test.ts` covers reuse,
expiry and forgery. Checked against the code before ticking it rather than assumed.

With both, **every `CRITICAL` security task in the tracker is complete.** `SEC-008`
(`PermissionGuard` + CI route coverage) is partly done: the admin guard fails closed on a
missing permission, but the customer-side CI check that enumerates routes does not exist.

`ADMIN-004` is `PARTIAL` — workspace metadata, vehicles and document metadata are built;
user lookup, suspension and reactivation are not.

`WS-002`, `WS-003`, `WS-004` and `WS-005` are `DONE`: the platform is now genuinely
multi-user. Roles can be changed, members removed, ownership transferred atomically, and
people invited by email with an acceptance flow. `WS-007` (shared-workspace E2E coverage)
remains, though `verify-members.mjs` already drives two real accounts end to end.

**Both tracker inaccuracies are now resolved.** The repository has its first commit — 404
files, no secrets — and a CI workflow exists where `.github/workflows/` was empty.
`CORE-020` is `REVIEW`, not `DONE`: its acceptance criteria require a passing run and it
has never executed, because the push is still pending GitHub credentials. It becomes
`DONE` on the first green run.

Fixed on the way: three `high` advisories in `nodemailer`, a dependency this platform
calls directly (7.0.9 → 10.0.10). The two that remain are transitive through Prisma,
unreachable from this code, and documented with end conditions in
`docs/security/audit-exceptions.md` rather than silently suppressed.

`OWN-006` is `DONE` and **`OWN-008` is finally `DONE` with it**: fuel was the last cost
source that did not reach the expense ledger, so a vehicle's total cost of ownership is
now complete. Consumption is computed tank to tank by a pure engine with 23 unit tests;
`RPT-003` (fuel economy trends) is unblocked.

`RPT-001`, `RPT-002` and `RPT-005` are `DONE`. The report answers the question `INIT.md`
§1 poses — what a vehicle has cost, per mile and per year — and refuses to answer when the
data cannot support it, naming which figure is missing and why.

**A flaw in the verification scripts was found and fixed this session.** 38 checks across
12 scripts used `ok(cond ? 'good' : 'BAD')`, which printed a tick beside failure text and
left the exit code at zero, so their "Errors: none" verdicts were weaker than they read.
All now use a `check()` that fails properly (DECISIONS.md D-079). The sweep afterwards
surfaced two console errors, both of which turned out to be deliberately provoked — but
that was luck, not design.

**Next recommended task:** `HARD-003` (document pipeline penetration review), `VEH-003`
(archival and soft delete — the last obvious gap in the vehicle lifecycle), or `RPT-003`
(fuel economy trends), which is a small addition now that both fuel and reports exist.

`OWN-001`, `OWN-002` and `OWN-003` delivered inspections with advisories, insurance
policies and road tax, each with an expiry feeding the reminder engine through
`REM-002`'s source interface — the first proof that adding a reminder kind needs no change
to the engine. `OWN-004` (warranties) is the natural follow-on and reuses the same shape.

`OWN-007` (expenses) is `DONE` and `OWN-008` (projection) is `PARTIAL`: services,
insurance and road tax project into the ledger, but **fuel does not**, because `OWN-006`
(fuel entries) does not exist yet. The projection service already has a `FUEL` source
type and category, so `OWN-006` is a collector plus one call, not a redesign. `RPT-001`
(cost aggregation) is now unblocked — `GET /expenses/summary` already groups by category
and vehicle, so a report is presentation over an existing query.

`OWN-009` (ownership UI tabs) stays `BACKLOG`: the vehicle now has Ownership and Expenses
tabs, but tyres and fuel have no UI.

**Counts are derived, not hand-maintained.** The table above is recomputed by parsing every
`Status:` field and backlog row; an earlier edition drifted because it was updated by hand.

Phase 4 tasks delivered this session (marked DONE in the Phase 3–12 backlog table below):
`SRV-001` service categories, `SRV-002` service records with parts, `SRV-003` the service
creation transaction, `SRV-004` service history UI, `MNT-001` the pure maintenance engine,
`MNT-002` its fixture table, `MNT-003` rules with templates and overrides, `MNT-004`
due-state persistence, `MNT-005` maintenance UI. `VEH-007` (timeline aggregation) was
rebuilt as a shared multi-source aggregator.

### Phase 1 exit criteria — met
`pnpm install && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev:all`
brings up all five applications. `/api/v1/health/ready` reports the database up.
`pnpm build` (15 packages), `pnpm typecheck` (25 tasks), `pnpm lint` (25 tasks, zero
warnings) and `pnpm test` (217 tests) all pass. The tenant isolation suite is green and
blocking, and the security-invariant lint rules are verified to fire on violations.

### Verified working, end to end (updated after Phase 2/4 work)
- register / login / dev-login / logout / session, with sessions stored as hashes
- workspace resolution, membership and role enforcement
- vehicle list, create, detail, timeline
- odometer history (append-only), current reading with staleness, regression rejection
  and the audited correction path
- dashboard with genuinely derived attention items
- API → Redis → worker → EmailService → Mailpit, with idempotent delivery
- email verification: register → token emailed → verify → welcome email; replay rejected
- password reset: uniform response, token single-use, all sessions revoked, alert emailed
- rate limiting on login/register/reset, returning 429 with Retry-After
- service history: create with parts, filter, view detail, soft delete
- maintenance: templates, server-computed status, mark-done, edit interval, completion history
- creating a service advances the matching rule and records an odometer reading, atomically

---

# PHASE 0 — PROJECT SPECIFICATION

---

```text
ID:            DOC-001
Title:         Repository structure and Git initialisation
Phase:         0
Status:        DONE
Priority:      CRITICAL
Dependencies:  —
```
**Description:** Create the monorepo directory skeleton and initialise version control.
**Acceptance Criteria:** `apps/`, `packages/`, `docs/`, `infrastructure/` exist with the
subdirectories specified in `INIT.md` §6; repository initialised on `main`.
**Files / Modules:** repository root.
**Tests Required:** none.
**Documentation Required:** `INIT.md` §6.
**Notes:** Node 26.8.2, Docker 29.8.1, Compose 5.5.1 verified present. pnpm not installed —
Node 26 no longer bundles Corepack, so `npm install -g pnpm@12` is a prerequisite recorded
in `DEPLOYMENT.md` §1.1.

---

```text
ID:            DOC-002
Title:         Core specification documents
Phase:         0
Status:        DONE
Priority:      CRITICAL
Dependencies:  DOC-001
```
**Description:** Write `INIT.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`.
**Acceptance Criteria:** vision, scope, stack with verified versions, application
separation, tenancy model, RBAC matrices, engine designs, agent operating contract and
Definition of Done all documented and mutually consistent.
**Files / Modules:** `INIT.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`.
**Tests Required:** none.
**Documentation Required:** this task *is* documentation.
**Notes:** Dependency versions verified against the npm registry on 2026-09-20 rather than
assumed. Prisma pinned to 7.10.x because 8.x is currently a release candidate.

---

```text
ID:            DOC-003
Title:         Data model and ERD
Phase:         0
Status:        DONE
Priority:      CRITICAL
Dependencies:  DOC-002
```
**Description:** Design the complete data model, document invariants, and produce the ERD.
**Acceptance Criteria:** ~45 entities defined with keys, enums and constraints; tenant
isolation strategy specified down to composite foreign keys; deletion strategy, money,
distance, date and indexing rules documented; ERD rendered in six domain views.
**Files / Modules:** `DATABASE.md`, `docs/database/erd.md`.
**Tests Required:** none (the isolation suite this enables is `SEC-007`).
**Documentation Required:** `DATABASE.md`, `docs/database/erd.md`.
**Notes:** Deduplicated from the brief's candidate list — `maintenance_events` merged into
service linkage plus rule state; `background_job_metadata` dropped, since BullMQ owns job
state in Redis and only operator-relevant failures are projected into `system_events`.

---

```text
ID:            DOC-004
Title:         Security, API and email specifications
Phase:         0
Status:        DONE
Priority:      CRITICAL
Dependencies:  DOC-003
```
**Description:** Document the threat model and controls, the HTTP contract, and the email
delivery pipeline.
**Acceptance Criteria:** 12 threats with named controls; three-layer isolation specified;
error format with a code catalogue; full endpoint map; email pipeline with idempotency key
derivation, delivery-status machine and webhook verification.
**Files / Modules:** `SECURITY.md`, `API.md`, `EMAILS.md`.
**Tests Required:** none.
**Documentation Required:** the three documents above.
**Notes:** `SECURITY.md` marks unimplemented controls as *(planned)* and explicitly claims
no compliance certification.

---

```text
ID:            DOC-005
Title:         UI/UX, testing and deployment specifications
Phase:         0
Status:        DONE
Priority:      HIGH
Dependencies:  DOC-002
```
**Description:** Define the design system direction, testing strategy and operational model.
**Acceptance Criteria:** semantic design tokens; component inventory; key screen layouts;
accessibility target; test pyramid with mandatory coverage areas; local development in four
commands; release procedure; backup and restore policy with quarterly restore testing.
**Files / Modules:** `UI_UX.md`, `TESTING.md`, `DEPLOYMENT.md`.
**Tests Required:** none.
**Documentation Required:** the three documents above.
**Notes:** —

---

```text
ID:            DOC-006
Title:         ADRs, roadmap, decision log and task tracker
Phase:         0
Status:        DONE
Priority:      HIGH
Dependencies:  DOC-004, DOC-005
```
**Description:** Record the formal architecture decisions, phase plan, chronological
decision log and task breakdown.
**Acceptance Criteria:** ADR-001…ADR-010 each with context, decision, alternatives and
consequences; 13 phases; decision log seeded; this tracker populated; `.env.example`
complete; `README.md` written.
**Files / Modules:** `docs/adr/*.md`, `ROADMAP.md`, `DECISIONS.md`, `CHANGELOG.md`,
`TASKS.md`, `README.md`, `.env.example`.
**Tests Required:** none.
**Documentation Required:** as above.
**Notes:** Completes Phase 0.

---

# PHASE 1 — ENGINEERING FOUNDATION

Goal: every application starts, every check runs, no product feature is implemented.

---

```text
ID:            CORE-001
Title:         pnpm workspace and Turborepo scaffolding
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  DOC-006
```
**Description:** Initialise the pnpm workspace and Turborepo pipeline. Define the root
`package.json` with the pinned `packageManager` field and every script referenced in
`CLAUDE.md`. Configure `turbo.json` task graph with correct `dependsOn` and caching.
**Acceptance Criteria:**
- `pnpm-workspace.yaml` includes `apps/*` and `packages/*`
- Root scripts exist: `dev`, `build`, `lint`, `typecheck`, `format`, `format:check`,
  `test`, `test:unit`, `test:integration`, `test:isolation`, `test:e2e`, `db:*`
- `turbo.json` declares `build` depending on `^build`, with `dist/**` outputs cached;
  `dev` marked persistent and uncached
- `pnpm install` succeeds from a clean clone
- `.gitignore` covers `node_modules`, `dist`, `.turbo`, `.env`, coverage, Playwright output
**Files / Modules:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`,
`.npmrc`, `.nvmrc`, `.editorconfig`.
**Tests Required:** none (verified by `pnpm install` and `pnpm build` succeeding).
**Documentation Required:** confirm `DEPLOYMENT.md` §1 commands match reality.
**Notes:** pnpm must be installed first (`npm install -g pnpm@12`). Pin exact majors; do
not use `^` ranges for framework dependencies.

---

```text
ID:            CORE-002
Title:         Shared TypeScript configuration
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-001
```
**Description:** Create `packages/tsconfig` with base, library, React and NestJS presets.
**Acceptance Criteria:**
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`,
  `noImplicitOverride: true`, `verbatimModuleSyntax: true`
- Presets: `base.json`, `library.json`, `react.json`, `node.json`
- Every package and app extends a preset and adds nothing beyond `include`/`outDir`
- `pnpm typecheck` passes across the workspace
**Files / Modules:** `packages/tsconfig/*.json`, `packages/tsconfig/package.json`.
**Tests Required:** none.
**Documentation Required:** none.
**Notes:** `noUncheckedIndexedAccess` is deliberate — array access returning `T | undefined`
catches a whole class of bug in report aggregation code.

---

```text
ID:            CORE-003
Title:         Shared ESLint and Prettier configuration
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-002
```
**Description:** Create `packages/eslint-config` (flat config) and the shared Prettier setup,
including the repository's guard rules.
**Acceptance Criteria:**
- Presets: `base`, `react`, `node`
- `no-restricted-imports` forbids the Resend SDK outside
  `packages/email/src/transports/`, and forbids cross-app imports
- `dangerouslySetInnerHTML` is an error
- Template-literal SQL outside `$queryRaw` tagged templates is an error
- `$unscoped(` is restricted to `apps/api/src/modules/admin/**` and `apps/worker/**`
- `pnpm lint` passes with zero warnings; `--max-warnings=0` in the script
**Files / Modules:** `packages/eslint-config/*`, `.prettierrc`, `.prettierignore`.
**Tests Required:** none.
**Documentation Required:** note the guard rules in `SECURITY.md` §14 if they change.
**Notes:** These lint rules enforce documented security invariants. They are controls, not
style preferences — do not relax them to unblock a build.

---

```text
ID:            CORE-004
Title:         packages/config — validated environment loading
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-002
```
**Description:** Zod-validated, typed environment configuration with per-application schemas.
**Acceptance Criteria:**
- Separate schemas for api, worker, marketing, dashboard, admin
- Application throws at startup on a missing, malformed, or placeholder-valued variable
- Secrets never logged; the config object's `toString` redacts
- `.env.example` and the schemas are kept in sync by a test
**Files / Modules:** `packages/config/src/*`.
**Tests Required:** unit — valid config parses; missing required throws; placeholder value
throws; `.env.example` satisfies every schema.
**Documentation Required:** `.env.example`, `DEPLOYMENT.md` §6.
**Notes:** The placeholder check is what prevents shipping with `RESEND_API_KEY=changeme`
and silently sending no email for a week.

---

```text
ID:            CORE-005
Title:         packages/types — shared domain types
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-002
```
**Description:** Domain enums, branded unit types, and shared DTO types.
**Acceptance Criteria:**
- Every enum from `DATABASE.md` §4 exported as a const object plus union type
- Branded `Miles`, `Kilometers`, `Metres` types; mixing them is a compile error
- `Money = { amount: string; currency: CurrencyCode }`
- `CalendarDate` branded string type with a `YYYY-MM-DD` guard
- No runtime dependencies beyond none
**Files / Modules:** `packages/types/src/*`.
**Tests Required:** unit — type-level tests asserting that mixing units fails to compile.
**Documentation Required:** none.
**Notes:** Branded types are the mechanism behind `AGENTS.md` rule 10. Make the wrong thing
impossible rather than documented.

---

```text
ID:            CORE-006
Title:         packages/logger — structured logging with correlation IDs
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-004
```
**Description:** Pino setup with redaction, correlation-ID propagation and environment-aware
formatting.
**Acceptance Criteria:**
- JSON in production, pretty in development
- Redaction covers `password`, `token`, `secret`, `authorization`, `cookie`, `set-cookie`,
  `apiKey`, at any nesting depth
- `AsyncLocalStorage`-based correlation context, accessible from services and jobs
- Child loggers carry correlation ID, user ID and workspace ID where known
**Files / Modules:** `packages/logger/src/*`.
**Tests Required:** unit — redaction of nested secrets; correlation ID propagates across
async boundaries.
**Documentation Required:** `ARCHITECTURE.md` §13.
**Notes:** Redaction must be tested with a realistic auth request body, not a flat object.

---

```text
ID:            CORE-007
Title:         packages/db — Prisma schema and initial migration
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-004, CORE-006
```
**Description:** Prisma schema for the identity and tenancy core, the generated client, and
the first migration. Vehicle and downstream models arrive in their own phases.
**Acceptance Criteria:**
- Models: `users`, `user_profiles`, `sessions`, `email_verification_tokens`,
  `password_reset_tokens`, `workspaces`, `workspace_members`, `workspace_invitations`,
  `plans`, `plan_features`, `subscriptions`, `audit_logs`
- UUID v7 primary keys; `timestamptz` timestamps; `citext` emails
- Hand-written migration additions: the single-`OWNER` partial unique index
- Seed script: system service categories, expense categories, and the four plans
- `pnpm db:migrate` and `pnpm db:seed` succeed against a clean database
**Files / Modules:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*`,
`packages/db/prisma/seed.ts`, `packages/db/src/client.ts`.
**Tests Required:** integration — migration applies cleanly; seed is idempotent.
**Documentation Required:** `DATABASE.md` if the schema diverges from the design.
**Notes:** Do not add `workspaceId` to a model without also planning its composite foreign
key (`SEC-006`). The tenant extension keys off the presence of that field.

---

```text
ID:            CORE-008
Title:         Docker Compose local infrastructure
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-001
```
**Description:** PostgreSQL, Redis, MinIO and Mailpit for local development.
**Acceptance Criteria:**
- PostgreSQL 18 with `citext` enabled and a named volume
- Redis 8 with appendonly persistence
- MinIO with the `autoservices` bucket created on startup and **not** public
- Mailpit on SMTP 1025 / UI 8025
- Health checks on every service; `docker compose up -d` reaches healthy without manual steps
**Files / Modules:** `docker-compose.yml`, `infrastructure/docker/*`.
**Tests Required:** none (verified by the integration suite connecting successfully).
**Documentation Required:** `DEPLOYMENT.md` §1.
**Notes:** The MinIO bucket must be private from creation. A local habit of public buckets
becomes a production incident.

---

```text
ID:            CORE-009
Title:         API application skeleton
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-004, CORE-006, CORE-007
```
**Description:** NestJS on Fastify with the cross-cutting infrastructure and health
endpoints. No business modules.
**Acceptance Criteria:**
- Fastify adapter, global `/api/v1` prefix
- Correlation-ID middleware accepting and echoing `X-Request-Id`
- Global exception filter producing the `API.md` §5 error envelope
- Zod validation pipe
- Security headers, CORS allow-list, cookie support, raw-body route for webhooks
- OpenAPI at `/api/v1/docs`, disabled in production
- `/health`, `/health/live`, `/health/ready` with real Postgres and Redis checks
- Graceful shutdown on `SIGTERM`
**Files / Modules:** `apps/api/src/main.ts`, `app.module.ts`, `common/**`, `modules/health/**`.
**Tests Required:** integration — health endpoints; error filter shape for a thrown domain
error; unknown query parameter rejected with 422.
**Documentation Required:** `API.md` if conventions change.
**Notes:** The error filter must never leak stack traces in production. Test that explicitly.

---

```text
ID:            CORE-010
Title:         Worker application skeleton
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-004, CORE-006
```
**Description:** BullMQ worker process with queue registration, a no-op repeatable scheduler,
graceful shutdown and failure reporting.
**Acceptance Criteria:**
- Queues registered per `ARCHITECTURE.md` §12 with their retry and backoff policies
- One repeatable heartbeat job proving scheduling works
- `SIGTERM` finishes the current job and stops accepting new ones
- Failed jobs recorded to `system_events`
- Shares `packages/db`, `packages/logger`, `packages/config` with the API
**Files / Modules:** `apps/worker/src/*`.
**Tests Required:** integration — a job enqueued by the API is processed; a failing job
retries with backoff and lands in the failed set.
**Documentation Required:** `ARCHITECTURE.md` §12 if queues change.
**Notes:** The worker has no HTTP ingress. Keep it that way.

---

```text
ID:            CORE-011
Title:         packages/validation — shared Zod schemas
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-005
```
**Description:** The shared schema layer used by API validation and client forms.
**Acceptance Criteria:**
- Primitives: email, password, calendar date, money, distance, pagination, sort, ID
- Strict objects — unknown keys rejected, not stripped silently
- Every string bounded, every number bounded, every enum closed
- Zero dependency on the database or the server
**Files / Modules:** `packages/validation/src/*`.
**Tests Required:** unit — boundary cases for each primitive; unknown-key rejection.
**Documentation Required:** `API.md` §9.
**Notes:** One definition, two consumers. A frontend that validates differently from the
server is a bug factory.

---

```text
ID:            CORE-012
Title:         packages/permissions — RBAC policy engine
Phase:         1
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-005
```
**Description:** Pure implementation of the workspace and admin role matrices.
**Acceptance Criteria:**
- `can(role, permission, ctx?)` implementing `ARCHITECTURE.md` §5 exactly
- Admin permissions are a separate, non-overlapping namespace and type
- OWNER protections encoded: ADMIN cannot modify or remove an OWNER
- No I/O, no imports beyond `packages/types`
**Files / Modules:** `packages/permissions/src/*`.
**Tests Required:** unit — the **complete** role × permission matrix, generated from the
table, so a matrix change without a test change fails.
**Documentation Required:** `ARCHITECTURE.md` §5 is the source of truth; keep it in step.
**Notes:** Written before the endpoints it protects (`ROADMAP.md` sequencing rule 5).

---

```text
ID:            CORE-013
Title:         packages/ui — design tokens and primitives
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-002
```
**Description:** Tailwind 4 theme with semantic tokens, plus the first primitive components.
**Acceptance Criteria:**
- Tokens per `UI_UX.md` §2 as CSS custom properties exposed through `@theme`
- Light and dark themes as token remappings
- Primitives: Button, Input, Label, FormField, Card, Badge, StatusBadge, Skeleton, Dialog
- Every component keyboard-operable with a visible focus indicator
- Storybook or a preview route rendering every component in both themes
**Files / Modules:** `packages/ui/src/tokens/*`, `packages/ui/src/primitives/*`.
**Tests Required:** unit — StatusBadge renders icon and label, not colour alone;
`axe-core` check on the primitive set.
**Documentation Required:** `UI_UX.md` if tokens change.
**Notes:** No app defines its own colours or spacing. Ever.

---

```text
ID:            CORE-014
Title:         packages/email — service abstraction and transports
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-004, CORE-006
```
**Description:** `EmailService`, the `MailTransport` interface, all three transports, the
base layout and one working template.
**Acceptance Criteria:**
- `MemoryTransport` is the default when `NODE_ENV=test`
- `ResendTransport` throws at construction when `NODE_ENV=test`
- `SmtpTransport` delivers to Mailpit in development
- `BaseLayout` plus the `verify-email` template, with HTML and hand-written plain text
- A template preview server renders every template with sample props
**Files / Modules:** `packages/email/src/*`.
**Tests Required:** unit — transport selection per environment; template renders non-empty
HTML and text with an absolute CTA URL.
**Documentation Required:** `EMAILS.md`.
**Notes:** Nothing outside `transports/resend.transport.ts` may import the Resend SDK; the
lint rule from `CORE-003` enforces it.

---

```text
ID:            CORE-015
Title:         Marketing application scaffold
Phase:         1
Status:        DONE
Priority:      MEDIUM
Dependencies:  CORE-013
```
**Description:** Vite + React static site with the SEO foundation and a placeholder homepage.
**Acceptance Criteria:** builds to static output; per-page meta, OpenGraph and canonical
tags; `robots.txt` and `sitemap.xml` generated at build; Lighthouse ≥ 95 on the placeholder.
**Files / Modules:** `apps/marketing/*`.
**Tests Required:** build succeeds; Lighthouse CI budget enforced.
**Documentation Required:** `UI_UX.md` §10.
**Notes:** Content pages are Phase 3+. This establishes the SEO scaffolding only.

---

```text
ID:            CORE-016
Title:         Dashboard application scaffold
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-013, CORE-018
```
**Description:** Vite + React SPA shell with routing, query client, error boundary and layout.
**Acceptance Criteria:** React Router with a protected-route wrapper; TanStack Query with
sensible defaults and a typed error shape; global error boundary; the app shell from
`UI_UX.md` §4.1; responsive at 360 px.
**Files / Modules:** `apps/dashboard/*`.
**Tests Required:** build succeeds; shell renders at mobile and desktop widths.
**Documentation Required:** none.
**Notes:** No real data. Navigation targets render placeholder pages.

---

```text
ID:            CORE-017
Title:         Admin application scaffold
Phase:         1
Status:        DONE
Priority:      MEDIUM
Dependencies:  CORE-013, CORE-018
```
**Description:** Separate admin SPA with its own auth context and origin.
**Acceptance Criteria:** independent build and origin; separate cookie name and API base
path; visually distinct from the dashboard so an operator always knows which they are in;
imports nothing from `apps/dashboard`.
**Files / Modules:** `apps/admin/*`.
**Tests Required:** build succeeds; a lint check proves no cross-app import.
**Documentation Required:** `INIT.md` §4.
**Notes:** Never a route inside the dashboard. This separation is a security boundary.

---

```text
ID:            CORE-018
Title:         packages/api-client — typed API client
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-011
```
**Description:** Typed fetch client with credentials, CSRF, correlation IDs, error mapping
and TanStack Query helpers.
**Acceptance Criteria:** types derived from `packages/validation`; `credentials: 'include'`;
CSRF header on mutations; parses the standard error envelope into a typed `ApiError`
carrying `code`, `message`, `requestId` and `details`; retries only idempotent methods.
**Files / Modules:** `packages/api-client/src/*`.
**Tests Required:** unit — error envelope parsing; no retry on `POST`; CSRF header present.
**Documentation Required:** `API.md`.
**Notes:** Generated from the OpenAPI spec once the API is real, so the client cannot drift.

---

```text
ID:            CORE-019
Title:         packages/test-utils — harness and factories
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-007, CORE-009
```
**Description:** Integration test harness with an ephemeral database, factories and a
controllable clock.
**Acceptance Criteria:** `createTestContext()` returns app, database, Redis and
`MemoryTransport`; per-suite schema isolation with truncation between tests; factories for
every entity producing valid defaults with partial overrides; deterministic seeded faker;
injectable clock.
**Files / Modules:** `packages/test-utils/src/*`.
**Tests Required:** the harness's own smoke test.
**Documentation Required:** `TESTING.md` §4.
**Notes:** Parallel-safe from the start. Retrofitting parallelism into a test suite that
assumed a single shared database is painful.

---

```text
ID:            CORE-020
Title:         CI pipeline
Phase:         1
Status:        REVIEW
Priority:      CRITICAL
Dependencies:  CORE-003, CORE-019
```
**Description:** GitHub Actions workflow running the full gate on every pull request.
**Acceptance Criteria:** install (cached) → format:check → lint → typecheck → test:unit →
build → test:integration (service containers) → audit + secret scan; Turborepo remote cache
or actions cache; `main` protected on a green run; total runtime under 10 minutes.
**Files / Modules:** `.github/workflows/ci.yml`.
**Tests Required:** the workflow itself, proven by a passing run.
**Documentation Required:** `TESTING.md` §9.
**Notes:** `test:isolation` and `test:e2e` join the gate in Phase 2, when there is something
to isolate.

**2026-09-22.** This task was marked `DONE` for a long time while `.github/workflows/` was
**empty** — there was no pipeline at all. The workflow now exists (`static`, `test`,
`audit`), with service containers for PostgreSQL 18, Redis 8, MinIO and Mailpit, and it
runs the same gate used locally. It is `REVIEW` rather than `DONE` because the acceptance
criteria require "a passing run", and it has never executed: the repository had no remote
until today and the push is still pending credentials. Mark it `DONE` on the first green
run, and only then.

---

```text
ID:            CORE-021
Title:         Production Dockerfiles
Phase:         1
Status:        BACKLOG
Priority:      MEDIUM
Dependencies:  CORE-009, CORE-010, CORE-015, CORE-016, CORE-017
```
**Description:** Multi-stage production images for all five applications.
**Acceptance Criteria:** non-root user; no build tooling in the runtime stage; `HEALTHCHECK`
on `/health/live` for API and worker; images tagged by Git SHA; API image under 300 MB;
`docker compose -f docker-compose.prod.yml up` runs the full stack locally.
**Files / Modules:** `infrastructure/docker/*.Dockerfile`, `docker-compose.prod.yml`.
**Tests Required:** images build and the containers pass their health checks.
**Documentation Required:** `DEPLOYMENT.md` §4.
**Notes:** API and worker share build stages to keep images small and versions identical.

---

# PHASE 2 — AUTHENTICATION & TENANCY

**This phase gates every subsequent phase.** No product feature ships before tenant
isolation is proven by a passing generated test suite.

---

```text
ID:            SEC-001
Title:         Password hashing with versioned Argon2id parameters
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-007
```
**Description:** `packages/auth` password primitives.
**Acceptance Criteria:** Argon2id at `memoryCost 19456`, `timeCost 2`, `parallelism 1`;
parameters versioned in the hash and upgraded on next successful login when they change;
verification is constant-time; a dummy hash is verified when the user does not exist, so
login timing does not reveal account existence; minimum 12 characters.
**Files / Modules:** `packages/auth/src/password.ts`.
**Tests Required:** unit — hash/verify round trip; wrong password fails; parameter upgrade
path; timing equalisation performs a comparison on the unknown-user path.
**Documentation Required:** `SECURITY.md` §4.
**Notes:** Parameters are OWASP's current minimum. Do not lower them for test speed — use a
reduced-cost profile selected by `NODE_ENV=test` instead.

---

```text
ID:            SEC-002
Title:         Session management with hashed tokens
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-001
```
**Description:** Opaque session tokens, cookie handling, rotation and revocation.
**Acceptance Criteria:** 32-byte CSPRNG token, only its SHA-256 hash stored; cookie
`HttpOnly`, `Secure`, `SameSite=Lax`; 30-day absolute and 14-day idle lifetimes;
`last_seen_at` throttled to one write per 5 minutes; rotation on privilege change; single
and bulk revocation; admin sessions on a separate cookie, table and 8-hour lifetime.
**Files / Modules:** `packages/auth/src/session.ts`, `apps/api/src/common/guards/session.guard.ts`.
**Tests Required:** integration — expired and revoked sessions rejected; rotation on password
change; revoke-all leaves only the acting session; admin cookie is not accepted by customer
routes and vice versa.
**Documentation Required:** `SECURITY.md` §5.
**Notes:** Storing the hash means a database leak yields no usable sessions.

---

```text
ID:            SEC-003
Title:         Hashed, single-use verification and reset tokens
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-001
```
**Description:** Email verification and password reset token lifecycle.
**Acceptance Criteria:** 32-byte CSPRNG, SHA-256 hash stored, plaintext only in the email;
verification 24 h, reset 1 h; single use via `consumed_at`; issuing a new token invalidates
the previous; a password change invalidates all outstanding reset tokens; reset consumption
revokes all sessions.
**Files / Modules:** `packages/auth/src/tokens.ts`, `apps/api/src/modules/auth/*`.
**Tests Required:** integration — reuse rejected; expiry rejected; reissue invalidates the
old token; reset revokes sessions.
**Documentation Required:** `SECURITY.md` §4.
**Notes:** Plaintext tokens must never be logged, returned in a response, or stored.

---

```text
ID:            SEC-005
Title:         Prisma tenant-scoping extension
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  CORE-007
```
**Description:** The data-layer isolation mechanism (`ARCHITECTURE.md` §4, layer 2).
**Acceptance Criteria:** `forWorkspace(prisma, workspaceId)` injects `workspaceId` into
every `where` for reads, updates and deletes, and into `data` for creates; the tenant-owned
model set is derived from the DMMF by the presence of a `workspaceId` field, so new models
are covered automatically; nested writes are covered; `$unscoped()` is the only bypass, is
lint-restricted, and logs an audit entry when used against customer data.
**Files / Modules:** `packages/db/src/tenant-client.ts`.
**Tests Required:** integration — for every operation type, a query for workspace B's row
from workspace A's client returns nothing; create ignores a client-supplied `workspaceId`
and uses the context's; nested create inherits the scope.
**Documentation Required:** `ARCHITECTURE.md` §4, `SECURITY.md` §3.
**Notes:** **The single most important file in the codebase.** Derive the model set from the
schema; never hand-maintain a list, because the list is what gets forgotten.

---

```text
ID:            SEC-006
Title:         Composite foreign keys on tenant-owned children
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-005
```
**Description:** Database-level cross-tenant integrity (`ARCHITECTURE.md` §4, layer 3).
**Acceptance Criteria:** `UNIQUE (id, workspace_id)` on every tenant-owned parent; child
foreign keys reference `(parent_id, workspace_id)`; delivered as hand-written SQL appended
to the Prisma migration; a schema check fails CI when a tenant-owned child lacks one.
**Files / Modules:** `packages/db/prisma/migrations/*`, `packages/db/src/schema-checks.ts`.
**Tests Required:** integration — a direct SQL insert pairing a parent and child from
different workspaces is rejected by the database.
**Documentation Required:** `DATABASE.md` §3.
**Notes:** This is the layer that holds when application code has a bug. Test it by
bypassing the application entirely.

---

```text
ID:            SEC-004
Title:         WorkspaceGuard and PermissionGuard
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-002, SEC-005, CORE-012
```
**Description:** Request-level tenancy and authorisation (`ARCHITECTURE.md` §4, layer 1).
**Acceptance Criteria:** `WorkspaceGuard` resolves the workspace from the route and requires
an ACTIVE membership, returning **404, not 403**, for non-members; the resolved context is
immutable on the request; `@RequirePermission` evaluates against the database role for this
request, never a token claim; `@CurrentUser` and `@CurrentWorkspace` decorators; a CI check
enumerates routes and fails on any lacking an explicit `@RequirePermission` or `@Public`.
**Files / Modules:** `apps/api/src/common/guards/*`, `apps/api/src/common/decorators/*`.
**Tests Required:** integration — non-member gets 404; insufficient role gets 403; role
change takes effect on the next request without re-login.
**Documentation Required:** `SECURITY.md` §3, §6.
**Notes:** 404-over-403 across tenants is a security control, not a UX choice.

---

```text
ID:            SEC-007
Title:         Generated cross-tenant isolation test suite
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-004, SEC-006, CORE-019
```
**Description:** `pnpm test:isolation` — the suite that proves the security boundary.
**Acceptance Criteria:** enumerates every `workspaceId`-bearing model from the Prisma schema;
asserts 404 for list, read, update and delete across tenants for each; asserts every
tenant-owned child has its composite foreign key; asserts `$unscoped(` appears nowhere
outside `modules/admin` and `apps/worker`; asserts every route has an explicit permission
decorator; wired into CI as a blocking gate.
**Files / Modules:** `apps/api/test/isolation/*`.
**Tests Required:** this task *is* tests. It must also fail correctly — verified by
temporarily removing a guard and confirming a red run.
**Documentation Required:** `TESTING.md` §4.1, `SECURITY.md` §3.
**Notes:** Generated, not hand-written, precisely so a new model cannot be omitted. A test
suite that only covers what someone remembered is not a control.

---

```text
ID:            AUTH-001
Title:         Registration with automatic personal workspace
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-001, SEC-003, CORE-014
```
**Description:** `POST /auth/register` — the transaction that bootstraps a tenant.
**Acceptance Criteria:** single transaction creating user + profile + personal workspace +
OWNER membership + default notification preferences + FREE subscription; verification email
enqueued; **uniform response whether or not the email already exists**; rate limited 3/hour
per IP; audit entry written.
**Files / Modules:** `apps/api/src/modules/auth/*`, `apps/api/src/modules/workspaces/*`.
**Tests Required:** integration — all six rows created atomically; a forced failure rolls
back completely; duplicate email returns the same response as a new one; rate limit enforced.
**Documentation Required:** `API.md` §6.1, `PRODUCT.md` §4.1.
**Notes:** Partial registration state is a support burden forever. One transaction, no
exceptions.

---

```text
ID:            AUTH-002
Title:         Email verification
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  AUTH-001
```
**Description:** Verification and resend endpoints plus the confirmation UI.
**Acceptance Criteria:** token consumption sets `email_verified_at` and sends the welcome
email; resend is rate limited 3/hour; unverified users may sign in but cannot create a
second workspace, invite members, or receive non-transactional email.
**Files / Modules:** `apps/api/src/modules/auth/*`, `apps/dashboard/src/routes/verify/*`.
**Tests Required:** integration — valid token verifies; expired, reused and unknown tokens
rejected; unverified restrictions enforced.
**Documentation Required:** `API.md` §6.1.
**Notes:** —

---

```text
ID:            AUTH-003
Title:         Login, logout and lockout
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-002
```
**Description:** Session creation and destruction with abuse protection.
**Acceptance Criteria:** identical error message for unknown email and wrong password;
timing equalised; progressive delay after 5 failures, temporary lock after 10, with a
security-alert email; lockout applied per account **and** per source IP; logout revokes the
current session; audit entries for success, failure and lockout.
**Files / Modules:** `apps/api/src/modules/auth/*`.
**Tests Required:** integration — enumeration resistance; lockout thresholds; IP-based limit;
successful login resets the counter.
**Documentation Required:** `SECURITY.md` §4, §8.
**Notes:** Per-IP limiting matters: without it, one attacker trying one common password
against every account can lock out the entire user base.

---

```text
ID:            AUTH-004
Title:         Password reset
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  SEC-003, AUTH-003
```
**Description:** Forgotten-password and reset endpoints with the matching UI.
**Acceptance Criteria:** uniform response for known and unknown addresses; token hashed,
single-use, 1-hour expiry; successful reset revokes **all** sessions and sends a
`password-changed` notification; rate limited 3/hour per email and 10/hour per IP.
**Files / Modules:** `apps/api/src/modules/auth/*`, `apps/dashboard/src/routes/reset/*`.
**Tests Required:** integration — full flow; enumeration resistance; all sessions revoked;
token reuse rejected.
**Documentation Required:** `API.md` §6.1, `SECURITY.md` §4.
**Notes:** —

---

```text
ID:            AUTH-005
Title:         Account settings and session management
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  AUTH-003
```
**Description:** Profile, preferences, password change, email change and the active-session
list.
**Acceptance Criteria:** timezone, locale, distance unit and currency editable and applied
throughout the product; password change requires the current password and rotates the
session; email change requires re-verification of the new address and notifies the old one;
session list shows device, approximate location and last seen, with individual and bulk
revocation.
**Files / Modules:** `apps/api/src/modules/users/*`, `apps/dashboard/src/routes/account/*`.
**Tests Required:** integration — preference changes persist and are reflected in responses;
email change requires verification; revocation invalidates the correct sessions.
**Documentation Required:** `API.md` §6.2.
**Notes:** Notifying the **old** address on an email change is what catches account takeover.

---

```text
ID:            WS-001
Title:         Workspace CRUD and settings
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  SEC-004
```
**Description:** Workspace lifecycle and settings management.
**Acceptance Criteria:** list workspaces for the current user; create (entitlement-checked);
update name, type, currency, distance unit and timezone; delete with a 30-day grace period
during which the workspace is suspended and restorable; personal workspaces cannot be
deleted while they are the user's only workspace.
**Files / Modules:** `apps/api/src/modules/workspaces/*`.
**Tests Required:** integration — permission matrix per operation; grace-period behaviour;
entitlement limit on creation.
**Documentation Required:** `API.md` §6.3.
**Notes:** —

---

```text
ID:            WS-002
Title:         Membership, roles and ownership transfer
Phase:         2
Status:        DONE
Priority:      CRITICAL
Dependencies:  WS-001, CORE-012
```
**Description:** Member listing, role changes, removal and ownership transfer.
**Acceptance Criteria:** exactly one ACTIVE OWNER enforced by the partial unique index;
ADMIN cannot modify or remove the OWNER; ownership transfer is a single atomic operation;
the last member cannot leave without transferring or deleting the workspace; every change
audited.
**Files / Modules:** `apps/api/src/modules/workspaces/members/*`.
**Tests Required:** integration — the full role matrix; ownership transfer atomicity; a
concurrent double transfer is rejected by the index; last-member protection.
**Documentation Required:** `ARCHITECTURE.md` §5.1.
**Notes:** Invitations are Phase 8. This task covers roles for members who already exist.

---

```text
ID:            SEC-009
Title:         Rate limiting
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-009
```
**Description:** Redis-backed sliding-window limits per `SECURITY.md` §8.
**Acceptance Criteria:** the documented limits applied; evaluated before any database work;
`Retry-After` returned; rejections recorded as `system_events`; limits configurable by
environment without a deploy.
**Files / Modules:** `apps/api/src/common/guards/rate-limit.guard.ts`.
**Tests Required:** integration — limit enforced, window slides correctly, per-IP and
per-identifier limits are independent.
**Documentation Required:** `SECURITY.md` §8.
**Notes:** —

---

```text
ID:            SEC-014
Title:         Audit logging infrastructure
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-007
```
**Description:** The append-only audit trail and its emission interceptor.
**Acceptance Criteria:** `AuditService.record()` with actor, action, resource, workspace,
hashed IP, user agent, correlation ID and metadata; append-only with no application delete
path; a metadata sanitiser that strips anything resembling a secret; every action listed in
`SECURITY.md` §15 emitting a record.
**Files / Modules:** `apps/api/src/common/audit/*`.
**Tests Required:** unit — the sanitiser drops password, token and secret keys at any depth.
Integration — auth and membership events produce correct records.
**Documentation Required:** `SECURITY.md` §15.
**Notes:** Test the sanitiser adversarially: nested objects, arrays, and keys like
`user_password_confirmation`.

---

```text
ID:            UI-001
Title:         Authentication screens
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-016, AUTH-004
```
**Description:** Register, login, verify, forgot-password and reset-password screens.
**Acceptance Criteria:** React Hook Form with the shared Zod schemas; inline field errors
mapped from `details`; loading and error states on every submission; fully keyboard
operable and screen-reader labelled; responsive at 360 px; password strength feedback
without blocking composition rules.
**Files / Modules:** `apps/dashboard/src/routes/auth/*`.
**Tests Required:** E2E — the full registration → verification → login journey (E2E-1's
first half).
**Documentation Required:** none.
**Notes:** Error copy follows `UI_UX.md` §7: say what to do, not what failed.

---

```text
ID:            UI-002
Title:         Dashboard shell and workspace switcher
Phase:         2
Status:        IN_PROGRESS
Priority:      HIGH
Dependencies:  CORE-016, WS-002
```
**Description:** The authenticated application shell.
**Acceptance Criteria:** the layout from `UI_UX.md` §4.1; workspace switcher always visible
with the current workspace unmistakable; navigation reflecting the user's role (cosmetically
— the server still decides); drawer and bottom tab bar below `lg`; skeleton loading states.
**Files / Modules:** `apps/dashboard/src/components/layout/*`.
**Tests Required:** E2E — switching workspaces changes the data shown; a VIEWER does not see
create actions.
**Documentation Required:** `UI_UX.md` §4.
**Notes:** Always knowing which tenant you are in is a safety property. Make it obvious.

---

```text
ID:            SEC-013
Title:         Resend webhook signature verification
Phase:         2
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-009
```
**Description:** The signature-verified webhook endpoint, built before it has events to
receive so Phase 5 can rely on it.
**Acceptance Criteria:** raw body preserved for verification; Svix signature verified in
constant time; timestamps older than 5 minutes rejected; returns 202 and queues processing;
invalid signature returns 401 and records a `system_event`.
**Files / Modules:** `apps/api/src/modules/webhooks/*`.
**Tests Required:** integration — valid signature accepted; tampered body rejected; stale
timestamp rejected; replayed event is a no-op.
**Documentation Required:** `EMAILS.md` §6, `SECURITY.md` §11.
**Notes:** The raw-body route must be registered before any JSON body parsing, or the
signature will never verify. Implemented by scoping a Fastify `preParsing` hook to
`/api/v1/webhooks/`, so no other route pays for raw-body capture.

**Deviation from the acceptance criteria, accepted:** the endpoint answers **200
synchronously** rather than 202-and-queue. The work is two indexed writes, and completing
them before replying is what lets the response state whether the event was a duplicate and
whether the address was suppressed — information a 202 would discard. Every other criterion
is met as written. See `API.md` §6.11.

**Verified:** `apps/api/test/integration/webhook.test.ts` — 13 cases covering no signature,
wrong secret, tampered body, stale timestamp, valid signature, out-of-order events,
replay, unknown message, and suppression.

---

# BACKLOG — PHASES 3–12

Compact entries. Each is expanded to a full task block when promoted to `READY`.
All are `BACKLOG` until their phase begins.

### Phase 3 — Vehicle core
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| VEH-001 | Vehicle schema and migration | PARTIAL | CRITICAL | SEC-006 
| VEH-002 | Vehicle CRUD with full attribute set | PARTIAL | CRITICAL | VEH-001, SEC-004 
| VEH-003 | Status lifecycle, archival and soft delete | BACKLOG | HIGH | VEH-002 
| VEH-004 | Odometer entries with regression protection | PARTIAL | CRITICAL | VEH-002 
| VEH-005 | Derived current mileage and staleness detection | PARTIAL | HIGH | VEH-004 
| VEH-006 | Vehicle images via the document pipeline | BACKLOG | MEDIUM | VEH-002, DOC-101 
| VEH-007 | Vehicle timeline aggregation endpoint | PARTIAL | HIGH | VEH-004 
| VEH-008 | Vehicle list and cards UI | PARTIAL | HIGH | VEH-002, UI-002 
| VEH-009 | Vehicle detail page with tab routing | BACKLOG | HIGH | VEH-007 
| VEH-010 | Onboarding flow, steps 1–7 with skip | BACKLOG | HIGH | VEH-002 

### Phase 4 — Service & maintenance
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| SRV-001 | Service categories, system and custom | DONE | HIGH | DONE  VEH-001 |
| SRV-002 | Service records with parts | DONE | CRITICAL | DONE  SRV-001 |
| SRV-003 | Service creation transaction (odometer + expense + rule advance) | DONE | CRITICAL | DONE  SRV-002, VEH-004 |
| SRV-004 | Service history UI and the streamlined add-service form | DONE | HIGH | DONE  SRV-003 |
| MNT-001 | Maintenance engine as pure functions | DONE | CRITICAL | DONE  CORE-005 |
| MNT-002 | Maintenance engine fixture table (~40 cases) | DONE | CRITICAL | DONE  MNT-001 |
| MNT-003 | Maintenance rules CRUD with templates and overrides | DONE | CRITICAL | DONE  MNT-001 |
| MNT-004 | Due-state persistence and recomputation triggers | DONE | CRITICAL | DONE  MNT-003 |
| MNT-005 | Maintenance UI and due list | DONE | HIGH | DONE  MNT-004 |

### Phase 5 — Reminders & email
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| REM-001 | Reminder schema and state machine | DONE | CRITICAL | MNT-004 
| REM-002 | Pluggable `ReminderSource` abstraction | DONE | CRITICAL | REM-001 
| REM-003 | Maintenance reminder source | DONE | HIGH | REM-002, MNT-004 
| REM-004 | Mileage-triggered re-evaluation on odometer write | DONE | HIGH | REM-003, VEH-004 
| REM-005 | Timezone-bucketed scheduler with quiet hours | DONE | CRITICAL | REM-002, CORE-010 
| REM-006 | Snooze, dismiss and complete endpoints | DONE | HIGH | REM-001 
| MAIL-001 | Full template set | PARTIAL | HIGH | CORE-014 
| MAIL-002 | Dispatch with preference and suppression checks | BACKLOG | CRITICAL | MAIL-001 
| MAIL-003 | Idempotency keys and delivery records | DONE | CRITICAL | MAIL-002 
| MAIL-004 | `email_messages` lifecycle and status ranking | DONE | HIGH | MAIL-003 
| MAIL-005 | Webhook event processing and suppression list | DONE | HIGH | MAIL-004, SEC-013 
| NOT-001 | In-app notification centre | DONE | HIGH | REM-001 
| NOT-002 | Notification preferences UI | PARTIAL | MEDIUM | MAIL-002 
| NOT-003 | Odometer staleness prompts | DONE | MEDIUM | VEH-005, REM-003 

### Phase 6 — Ownership modules
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| OWN-001 | Inspections and advisories | DONE | HIGH | VEH-002, REM-002 
| OWN-002 | Insurance policies | DONE | HIGH | VEH-002, REM-002 
| OWN-003 | Road tax and registration | DONE | HIGH | VEH-002, REM-002 
| OWN-004 | Warranties, including part and repair warranties | BACKLOG | MEDIUM | VEH-002, REM-002 
| OWN-005 | Tyre sets and installations | BACKLOG | MEDIUM | VEH-002 
| OWN-006 | Fuel entries and consumption calculation | DONE | HIGH | VEH-004 
| OWN-007 | Expenses and category management | DONE | HIGH | VEH-002 
| OWN-008 | Expense projection from services, fuel, insurance and tax | DONE | HIGH | OWN-007, SRV-003 
| OWN-009 | Ownership module UI tabs | BACKLOG | HIGH | OWN-001…OWN-007 

### Phase 7 — Documents
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| DOC-101 | Storage adapter and signed upload sessions | DONE | CRITICAL | CORE-008 
| DOC-102 | Finalisation with size and checksum verification | DONE | CRITICAL | DOC-101 
| DOC-103 | Signed downloads behind permission checks | DONE | CRITICAL | DOC-102 
| DOC-104 | MIME and extension allow-list with magic-byte sniffing | DONE | CRITICAL | DOC-101 
| DOC-105 | Storage accounting against entitlements | BACKLOG | HIGH | DOC-102 
| DOC-106 | Polymorphic attachment to domain records | DONE | HIGH | DOC-102 
| DOC-107 | Document vault UI | DONE | HIGH | DOC-106 
| DOC-108 | Orphan reaping and retention-based hard deletion | BACKLOG | HIGH | DOC-102 

### Phase 8 — Sharing
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| WS-003 | Workspace invitations by email | DONE | HIGH | WS-002, MAIL-001 
| WS-004 | Invitation acceptance flow | DONE | HIGH | WS-003 
| WS-005 | Member management UI | DONE | HIGH | WS-004 
| WS-006 | Per-member notification preferences | BACKLOG | MEDIUM | NOT-002 
| WS-007 | Shared-workspace E2E coverage | BACKLOG | HIGH | WS-005 

### Phase 9 — Administration
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| ADMIN-001 | Admin authentication realm with mandatory 2FA | DONE | CRITICAL | SEC-002 
| ADMIN-002 | Admin RBAC | DONE | CRITICAL | ADMIN-001, CORE-012 
| ADMIN-003 | Platform metrics dashboard | BACKLOG | HIGH | ADMIN-002 
| ADMIN-004 | User and workspace inspection | PARTIAL | HIGH | ADMIN-002 
| ADMIN-005 | Email delivery inspection | DONE | HIGH | MAIL-004 
| ADMIN-006 | Queue and failed-job management with retry | BACKLOG | HIGH | CORE-010 
| ADMIN-007 | Audit log viewer | BACKLOG | HIGH | SEC-014 
| ADMIN-008 | System health page | BACKLOG | MEDIUM | CORE-009 
| ADMIN-009 | Feature flag management | BACKLOG | MEDIUM | ADMIN-002 
| SEC-018 | Audited, time-boxed support access grants | DONE | CRITICAL | ADMIN-002, SEC-014 

### Phase 10 — Reports & export
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| RPT-001 | Cost aggregation by category, vehicle and period | DONE | HIGH | OWN-008 
| RPT-002 | Ownership cost and cost per distance | DONE | HIGH | RPT-001 
| RPT-003 | Fuel economy trends | BACKLOG | MEDIUM | OWN-006 
| RPT-004 | Workspace and fleet rollups | BACKLOG | MEDIUM | RPT-001 
| RPT-005 | Report UI with date-range filtering | DONE | HIGH | RPT-001 
| EXP-001 | Async export jobs (CSV, JSON) | BACKLOG | MEDIUM | RPT-001 
| EXP-002 | PDF vehicle history export | BACKLOG | MEDIUM | EXP-001 

### Phase 11 — Commercial foundation
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| PLAN-001 | Plans and features seeded from the database | BACKLOG | HIGH | CORE-007 
| PLAN-002 | Subscription model | BACKLOG | HIGH | PLAN-001 
| PLAN-003 | Usage counters with transactional maintenance | BACKLOG | HIGH | PLAN-002 
| PLAN-004 | `EntitlementService` with resolution order | BACKLOG | CRITICAL | PLAN-003 
| PLAN-005 | Entitlement guard returning 402 with upgrade context | BACKLOG | CRITICAL | PLAN-004 
| PLAN-006 | Nightly usage reconciliation | BACKLOG | HIGH | PLAN-003 
| PLAN-007 | Plan management in admin | BACKLOG | MEDIUM | PLAN-002, ADMIN-002 
| PLAN-008 | Pricing and upgrade UI | BACKLOG | MEDIUM | PLAN-005 
| PLAN-009 | Billing-provider interface, no provider attached | BACKLOG | MEDIUM | PLAN-002 

### Phase 12 — Production hardening
| ID | Title | Status | Priority | Depends on |
| --- | --- | --- | --- | --- |
| HARD-001 | Full security review against `SECURITY.md` | BACKLOG | CRITICAL | all 
| HARD-002 | Authorisation and isolation audit | BACKLOG | CRITICAL | SEC-007 
| HARD-003 | Document pipeline penetration review | BACKLOG | CRITICAL | DOC-104 
| HARD-004 | Query performance and N+1 sweep | BACKLOG | HIGH | all 
| HARD-005 | Index review against real query plans | BACKLOG | HIGH | HARD-004 
| HARD-006 | Backup **restore** rehearsal | BACKLOG | CRITICAL | — 
| HARD-007 | Observability and alerting completion | BACKLOG | HIGH | CORE-006 
| HARD-008 | Full E2E matrix | BACKLOG | HIGH | all 
| HARD-009 | Accessibility audit against WCAG 2.2 AA | BACKLOG | HIGH | all UI 
| HARD-010 | Load test at 10× expected volume | BACKLOG | MEDIUM | HARD-004 
| HARD-011 | Deployment and incident runbooks | BACKLOG | HIGH | HARD-007 

---

## Partial deliveries

These shipped a usable, verified slice but do **not** meet their full acceptance criteria.
They are counted as `PARTIAL`, never as `DONE`. Listing what is missing is the point —
an unqualified "done" here would misrepresent the product's state.

| Task | Shipped and verified | Still missing |
| --- | --- | --- |
| `VEH-001` | Vehicle schema, composite tenant FKs, indexes | `vehicle_images` has no write path |
| `VEH-002` | Create, list, detail with the full attribute set | Edit and archive have no UI; `PATCH` endpoint absent |
| `VEH-004` | Append-only odometer, regression rejection, audited correction | Bulk import, `source = IMPORT/API` paths |
| `VEH-005` | Derived current reading, 45-day staleness flag | Staleness does not yet drive a prompt or reminder |
| `VEH-007` | Multi-source timeline (service, mileage, purchase, sale, created) | Inspection, fuel, expense, document sources |
| `VEH-008` | Vehicle cards and list with client-side search | Server-side search, filters and URL-synced state |
| `MAIL-001` | Templates for verification, reset, welcome, service due/overdue, stale odometer, invitation | Inspection, insurance, tax, warranty, document, digest templates |
| `NOT-002` | Preferences API with per-category, per-channel opt-out | No preferences UI; opt-outs can only be set through the API |

## Reconciliation — DOC-007

The summary table above is **generated from this file**, not maintained by hand. An earlier
attempt to mark delivered Phase 4 rows silently matched nothing, so nine completed tasks
were invisible in the aggregate while their work was live in the product. That is the exact
failure DOC-007 was raised for.

To prevent recurrence:

- the compact tables carry an explicit `Status` column,
- `PARTIAL` is a first-class status with its evidence recorded above,
- the totals are recomputed from the file whenever tasks change.

`INIT.md` §Phase was still reporting Phase 0 and has been corrected.

## Discovered work

Tasks found during implementation are appended here with the task that uncovered them, then
triaged into a phase. Empty at the end of Phase 0.


```text
ID:            UI-003
Title:         Dashboard visual redesign — shell, overview and vehicle cards
Phase:         2
Status:        REVIEW
Priority:      HIGH
Dependencies:  CORE-016
```
**Description:** User-prioritised redesign of the existing dashboard presentation.
**Acceptance Criteria:** clearer navigation and visual hierarchy; semantic theme tokens;
responsive overview at 360/768/1440 px; real API data; explicit loading, empty and retry
states; existing routes and server contracts preserved.
**Files / Modules:** dashboard shell, overview, page header, vehicle card, copy catalogue.
**Tests Required:** browser verification of responsive layout, navigation and data states;
repository typecheck, lint, formatting, tests and build.
**Documentation Required:** UI_UX.md, CHANGELOG.md, DECISIONS.md.
**Notes:** Independent visual task; does not declare UI-002 or WS-002 complete.

**Verification:** 271 existing tests pass; typecheck and lint pass (25 tasks each).
Browser fixture checks pass at 360/768/1440 px in light/dark, including keyboard skip,
empty/loading/error states and retry. The initial global formatting failure (102 files) was resolved by CORE-022.
UI-003 remains REVIEW for final acceptance review; formatting is no longer a blocker.

```text
ID:            CORE-022
Title:         Restore repository formatting gate
Phase:         1
Status:        DONE
Priority:      HIGH
Dependencies:  CORE-001
```
**Discovered by:** UI-003.
**Acceptance Criteria:** review and format the remaining failing source/config files;
`pnpm format:check` passes without behavioural changes.
**Implementation:** 100 files formatted: 53 in apps, 39 in packages, seven scripts and
`turbo.json`. Two of the original 102 files were already formatted during UI-004. Each
result was verified to match exactly Prettier output from an external snapshot of its
original; no manual source edits, dependency changes or database changes in this task.
**Verification (2026-09-20):** `pnpm format:check` passed; `pnpm typecheck --force` and
`pnpm lint --force` passed (25 tasks each, zero cached); `pnpm test --force` passed
(271 tests across 10 files); `pnpm test:isolation` passed (31 tests); `pnpm build --force`
passed (15 tasks, zero cached). `node scripts/verify-dashboard-redesign.mjs` passed
responsive light/dark, navigation, keyboard, role, workspace, storage and data-state checks
using API fixtures. Existing bundle-size/Turbo output warnings remain non-blocking.
**Documentation:** development review updated. No user-visible behaviour changed, so no
CHANGELOG entry required. No dependent BACKLOG task names CORE-022; DOC-007 remains READY.

```text
ID:            DOC-007
Title:         Reconcile development status and acceptance evidence
Phase:         0
Status:        DONE
Priority:      HIGH
Dependencies:  DOC-001
```
**Discovered by:** UI-003.
**Acceptance Criteria:** reconcile TASKS aggregate counts with detailed task statuses,
clarify partial vehicle deliveries and update INIT phase based on verified completion.
**Notes:** see docs/product/development-review-2026-09-20.md. Newly discovered tasks are
not yet included in the existing stale aggregate table.

```text
ID:            UI-004
Title:         Accessible shell controls and role-aware vehicle entry points
Phase:         2
Status:        REVIEW
Priority:      HIGH
Dependencies:  CORE-012, CORE-016, WS-001
```
**Description:** Complete the independent shell interaction slice identified in UI-003.
**Acceptance Criteria:** native keyboard-operable workspace selection; modal mobile navigation
and account controls with Escape/focus restoration; mobile More action; vehicle-create links
hidden for VIEWER/DRIVER on shell, overview and vehicle list; reactive workspace selection
when localStorage is unavailable; existing server permissions unchanged.
**Tests Required:** browser fixtures covering roles, workspace switching, storage failure,
modal keyboard/focus behaviour and responsive navigation; all required checks and isolation.
**Notes:** UI-002 remains dependent on unfinished WS-002; this slice does not complete it.

**UI-004 verification:** `pnpm typecheck` and `pnpm lint`: 25 tasks successful each;
`pnpm test --force`: 271 tests passed; `pnpm test:isolation`: 31 tests passed;
`pnpm build`: 15 tasks successful. Browser fixture checks passed for role-aware entry
points, workspace-specific data, storage failure, responsive layouts, modal keyboard
behaviour and focus restoration. The initial `pnpm format:check` failure on 100 pre-existing files was resolved by CORE-022;
the full formatting gate now passes. Full real-stack multi-user E2E remains part of
UI-002; UI-004 stays REVIEW for final acceptance review. No database or server permission
changes.
