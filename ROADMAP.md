# ROADMAP.md — Delivery Phases

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20

Phases are dependency-ordered, not date-ordered. A phase is complete when every task in
it is `DONE` per the Definition of Done in `AGENTS.md` §6. Task detail lives in
`TASKS.md`; this document is the shape of the journey.

**Legend:** ✅ complete · 🔵 in progress · ⚪ not started

---

## ✅ Phase 0 — Project specification

**Goal:** a complete, internally consistent specification before any product code exists.

- [x] Repository structure
- [x] `INIT.md` — technical specification
- [x] `AGENTS.md` / `CLAUDE.md` — agent operating contracts
- [x] `PRODUCT.md` — personas, journeys, requirements, MVP boundary
- [x] `ARCHITECTURE.md` — system design, tenancy, RBAC, engines
- [x] `DATABASE.md` + `docs/database/erd.md` — data model and ERD
- [x] `SECURITY.md` — threat model and controls
- [x] `API.md` — conventions, error format, endpoint map
- [x] `EMAILS.md` — delivery pipeline and templates
- [x] `UI_UX.md` — design system direction
- [x] `TESTING.md` — testing strategy
- [x] `DEPLOYMENT.md` — environments, release, backups
- [x] `ROADMAP.md`, `TASKS.md`, `DECISIONS.md`, `CHANGELOG.md`, `README.md`
- [x] ADR-001 … ADR-010
- [x] `.env.example`

**Exit criteria:** the documents agree with each other; a new contributor can understand
the system without asking anyone.

---

## 🔵 Phase 1 — Engineering foundation

**Goal:** every application starts, every check runs, nothing is implemented.

pnpm workspace + Turborepo · shared `tsconfig` and `eslint-config` · Prettier ·
`packages/config`, `types`, `logger`, `validation`, `permissions`, `db`, `ui` skeletons ·
API with health endpoints and the error filter · worker with a no-op scheduler · three
frontend apps rendering a shell · Docker Compose (Postgres, Redis, MinIO, Mailpit) ·
Dockerfiles · CI pipeline · initial Prisma schema and migration.

**Exit criteria:** `pnpm install && docker compose up -d && pnpm db:migrate && pnpm dev`
starts everything; `/health/ready` is green; CI passes on an empty change.
**Deliberately excluded:** any product feature, any screen with real data.

---

## ⚪ Phase 2 — Authentication & tenancy

**Goal:** the security foundation, proven.

Registration with automatic personal workspace · email verification · login/logout ·
Argon2id · hashed tokens · sessions with revocation · password reset · workspace CRUD ·
memberships and roles · **the tenant-scoping Prisma extension** · composite foreign keys ·
`WorkspaceGuard`, `PermissionGuard` · **the generated isolation test suite** · rate
limiting · audit logging infrastructure · login/register/reset UI · workspace switcher.

**Exit criteria:** `pnpm test:isolation` green; E2E-2 (cross-tenant) green; every
auth flow works end to end against Mailpit.
**This phase gates everything after it.** No product feature ships before isolation is
proven, because retrofitting tenancy is how this kind of product fails.

---

## ⚪ Phase 3 — Vehicle core

Vehicle CRUD with the full attribute set · status lifecycle and archival · soft delete ·
vehicle images via the document pipeline · odometer entries with regression protection ·
derived current mileage · vehicle timeline endpoint · vehicle list and detail UI ·
vehicle cards · onboarding flow (steps 1–4).

**Exit criteria:** a user can register and reach a populated dashboard with a real
vehicle and mileage history in under four minutes.

---

## ⚪ Phase 4 — Service & maintenance

Service categories (system + custom) · service records with parts · attachments · the
maintenance engine as pure functions with an exhaustive fixture table · rules with
templates and user overrides · due-state persistence and recomputation triggers ·
service history and maintenance UI · the streamlined "add service" form.

**Exit criteria:** entering a service advances the matching rule, records the odometer,
and updates the timeline — from one form submission.

---

## ⚪ Phase 5 — Reminders & email

The generic reminder engine with pluggable sources · state machine · mileage-based
evaluation on odometer write · BullMQ queues and repeatable schedulers · timezone-bucketed
scheduling and quiet hours · `packages/email` with transports · the template set ·
`email_messages` and delivery events · the Resend webhook with signature verification ·
idempotency keys · the in-app notification centre · preference management UI.

**Exit criteria:** a maintenance item becoming due produces exactly one in-app
notification and exactly one email, at 09:00 in the user's local time, surviving worker
restarts and duplicate scheduler runs.

---

## ⚪ Phase 6 — Ownership modules

Inspections with advisories · insurance · road tax · warranty · tyre sets and
installations · fuel entries with consumption analytics · expenses with projection from
services, fuel, insurance and tax · expiry reminders wired into the Phase 5 engine · the
vehicle detail tabs for each.

**Exit criteria:** every expiry-bearing record produces reminders through the existing
engine with no engine changes — proving the source abstraction works.

---

## ⚪ Phase 7 — Documents

Upload sessions with presigned PUT · checksum and size verification · finalisation ·
signed downloads behind permission checks · MIME and extension allow-list · storage
accounting against entitlements · polymorphic attachment · document vault UI · nightly
orphan reaping · retention-based hard deletion.

**Exit criteria:** no private document is reachable without an authorised, short-lived,
signed URL; storage usage is accurate.

---

## ⚪ Phase 8 — Sharing

Workspace invitations by email · accept flow · role management UI · member removal ·
ownership transfer · per-member notification preferences · shared-workspace E2E coverage.

**Exit criteria:** a second member sees the shared garage, receives their own reminders,
and cannot exceed their role.

---

## ⚪ Phase 9 — Administration

Admin authentication (separate realm, separate origin, 2FA) · platform metrics · user and
workspace inspection · email delivery inspection · queue and failed-job management with
retry · audit log viewer · system health · feature flags · support access grants.

**Exit criteria:** an operator can answer "why didn't this user get their reminder?"
without a database console.

---

## ⚪ Phase 10 — Reports & export

Cost reports by category, vehicle and period · ownership cost and cost per distance ·
fuel economy trends · workspace/fleet rollups · date-range filtering · CSV, JSON and PDF
export via the reports queue · complete vehicle history export.

**Exit criteria:** a user selling a vehicle can download its complete, presentable history.

---

## ⚪ Phase 11 — Commercial foundation

Plans and features seeded from the database · subscriptions · usage counters with
transactional maintenance and nightly reconciliation · `EntitlementService` · the
entitlement guard returning 402 with upgrade context · plan management in admin ·
pricing UI · a billing-provider interface with no provider attached.

**Exit criteria:** limits are enforced server-side, no plan name appears in frontend
code, and adding a billing provider requires no domain changes.

---

## ⚪ Phase 12 — Production hardening

Full security review against `SECURITY.md` · authorisation and isolation audit ·
penetration-test-style review of the document pipeline · rate-limit tuning · query
performance and N+1 sweep · index review against real query plans · backup **restore**
rehearsal · observability and alerting completion · the full E2E matrix · accessibility
audit · load test at 10× expected volume · deployment runbooks.

**Exit criteria:** a tested restore, a green security review, and a documented runbook for
every alert.

---

## Beyond

Not scheduled, shaped for:

**Channels** — push, then PWA, then SMS/WhatsApp.
**Access** — granular per-vehicle member access (the join table already exists).
**Integrations** — government vehicle data, VIN decoding, OBD/GPS telemetry, workshops,
accounting.
**Platform** — public developer API with scoped keys, data import from other trackers,
localisation starting with Romanian, country-specific regulatory modules, native mobile.

---

## Sequencing rules

1. **Phase 2 gates everything.** No product data model ships before tenant isolation is
   proven by a passing generated test suite.
2. **The engine precedes its sources.** Phase 5 builds the reminder engine once; Phase 6
   plugs into it. Building inspection reminders before the engine produces five
   incompatible reminder implementations.
3. **Documents precede heavy attachment use.** Phase 7 before features that depend on
   attachments at scale; Phase 3 uses a minimal slice of it for vehicle images.
4. **Entitlements precede pricing pages.** Phase 11 before any public plan commitment.
5. **Within a phase, security tasks come first.** A guard is written before the endpoints
   it guards.
