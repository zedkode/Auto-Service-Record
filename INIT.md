# INIT.md — AutoServices Platform Specification

> **Status:** Living document. This is the highest-level technical specification for the
> platform. Every other document in this repository refines a section of this one.
> If this document and the code disagree, one of them is a bug — fix both.

**Document version:** 1.1
**Last updated:** 2026-09-20
**Phase:** 2 in progress (auth and tenancy), with Phase 4 service history and maintenance
delivered ahead of order. Phases 0 and 1 are complete. See `TASKS.md` for per-task status
and `docs/product/development-review-2026-09-20.md` for the standing assessment.

---

## 1. Vision

AutoServices is a multi-tenant SaaS platform that holds the **complete, permanent,
verifiable history of a vehicle** — and tells its owner what needs attention *before*
it becomes a problem.

Most people keep vehicle history in a shoebox of receipts, a spreadsheet, or nowhere at
all. The consequences are expensive: missed services, lapsed insurance, a failed
inspection discovered the day it expires, and a car that sells for less because nobody
can prove it was looked after.

The platform answers, for any vehicle, at any time:

- What was serviced, when, at what mileage, by whom, for how much?
- What parts were fitted, and are they still under warranty?
- What is due next — by date, by distance, or by whichever comes first?
- When do the insurance, inspection/MOT, road tax and warranty expire?
- What has this vehicle actually cost to own, per year and per mile?
- Where is the paperwork?

And it acts on that data: the platform notifies users of what is due or overdue, through
in-app notifications and email, with additional channels addable later without redesign.

### 1.1 What this is not

- **Not a single-user car tracker.** Tenancy is the foundation, not an afterthought.
- **Not a CRUD app over a `vehicles` table.** The maintenance engine, reminder engine,
  entitlement system and document vault are real subsystems with real invariants.
- **Not UK-only.** UK terminology (MOT) is a presentation concern over a generic
  `vehicle_inspection` domain concept.
- **Not a microservice estate.** It is a modular monolith API plus an independent worker.

---

## 2. Scope

### 2.1 In scope for the platform

| Domain | Summary |
| --- | --- |
| Identity | Registration, email verification, login, sessions, password reset, account settings |
| Tenancy | Workspaces, members, roles, invitations, per-workspace data isolation |
| Vehicles | Full vehicle records, images, status lifecycle, archival |
| Odometer | Append-only mileage history with source attribution |
| Service | Service records, categories, parts, labour, costs, attachments |
| Maintenance | Interval rules (time / distance / combined), due-state computation, overrides |
| Ownership | Inspection/MOT, insurance, road tax, warranty, tyres, fuel, expenses |
| Documents | S3-backed private document vault with signed upload/download |
| Contacts | Workshops, mechanics, suppliers, dealers, insurers |
| Reminders | Generic reminder engine over every expiry-bearing domain |
| Notifications | In-app notification centre, email via Resend, delivery tracking |
| Reporting | Cost, consumption and maintenance reporting; exports |
| Administration | Separate internal admin app with its own RBAC and audit trail |
| Commercial | Plans, entitlements, usage counters, billing-ready abstraction |

### 2.2 Explicitly deferred (architecture must not preclude)

Push/SMS/WhatsApp channels, mobile apps, public developer API, government vehicle
database integration (DVLA/DVSA and equivalents), VIN decoding, OBD/GPS telemetry,
accounting integrations, data import from competitors, per-vehicle granular member
access, localisation beyond English, real payment processing.

---

## 3. Core domain model

The single most important architectural decision in this product is the shape of the
tenancy graph. It is **not** `User → Vehicle`.

```text
User ──< WorkspaceMember >── Workspace
                                 │
                                 ├── Vehicle ──< ServiceRecord ──< ServicePart
                                 │      ├──< OdometerEntry
                                 │      ├──< MaintenanceRule
                                 │      ├──< VehicleInspection ──< InspectionAdvisory
                                 │      ├──< InsurancePolicy
                                 │      ├──< RoadTaxRecord
                                 │      ├──< Warranty
                                 │      ├──< TyreSet ──< TyreInstallation
                                 │      ├──< FuelEntry
                                 │      ├──< Expense
                                 │      └──< Document
                                 │
                                 ├──< Contact
                                 ├──< Reminder
                                 ├──< Notification
                                 ├──< Subscription
                                 └──< AuditLog
```

Every user receives a **Personal Garage** workspace on registration. A workspace may
later represent a family, a business, a fleet, a car club or any other group. The
product does not change shape when it does — only the member list and the plan do.

**Invariant:** every tenant-owned row carries a `workspace_id`, or is reachable from one
by a single unambiguous foreign-key hop that the data layer enforces.
Cross-workspace data leakage is a **CRITICAL security bug**, not a defect.

See `DATABASE.md` for the full ERD and `SECURITY.md` §3 for the isolation strategy.

---

## 4. Applications

Three separate frontends, one API, one worker. They share packages; they deploy
independently.

| App | Directory | Domain | Audience | Rendering |
| --- | --- | --- | --- | --- |
| Marketing | `apps/marketing` | `www.example.com` | Anonymous public | Static/SSG, SEO-critical |
| Dashboard | `apps/dashboard` | `app.example.com` | Authenticated customers | SPA |
| Admin | `apps/admin` | `admin.example.com` | Internal staff | SPA, separate auth realm |
| API | `apps/api` | `api.example.com` | All clients | NestJS modular monolith |
| Worker | `apps/worker` | — (no ingress) | — | BullMQ consumer + scheduler |

**The admin application is never a hidden route inside the dashboard.** It is a separate
build, a separate origin, a separate authentication realm, and a separate authorisation
system. A compromised customer session must not be one route away from platform-wide
data.

---

## 5. Technology stack

Versions verified against the npm registry on 2026-09-20. Pin exact majors in
`package.json`; do not float.

### 5.1 Runtime & tooling

| Concern | Choice | Version |
| --- | --- | --- |
| Runtime | Node.js | 26.x (Current; Active LTS 2026-10) |
| Language | TypeScript | 7.x |
| Package manager | pnpm | 12.x |
| Monorepo orchestration | Turborepo | 2.x |
| Containerisation | Docker + Compose | 29.x / 5.x |

> **Node 26 is currently the *Current* release and enters Active LTS in October 2026**
> (Node 24 "Krypton" is today's LTS). We target 26 deliberately: it is what the
> development machine already runs, and the LTS transition lands before Phase 2. If a
> problem forces it, dropping to 24 is a one-line change to `.nvmrc` and the Docker base
> image.
>
> Node 26 no longer bundles Corepack, so install pnpm explicitly:
> `npm install -g pnpm@12`. `packageManager` in the root `package.json` remains the
> source of truth for the pinned version.

### 5.2 Frontend

| Concern | Choice | Version |
| --- | --- | --- |
| UI library | React | 19.x |
| Build tool | Vite | 8.x |
| Styling | Tailwind CSS | 4.x |
| Routing | React Router | 8.x |
| Server state | TanStack Query | 5.x |
| Forms | React Hook Form | 7.x |
| Schema validation | Zod | 4.x |
| Component system | `packages/ui` (in-repo, Radix primitives) | — |

### 5.3 Backend

| Concern | Choice | Version |
| --- | --- | --- |
| Framework | NestJS | 12.x |
| HTTP adapter | Fastify | 5.x |
| API style | REST, versioned at `/api/v1` | — |
| API documentation | OpenAPI via `@nestjs/swagger` | 12.x |
| ORM | Prisma | 7.10.x (8.x is release-candidate; do not adopt yet) |
| Database | PostgreSQL | 18.x |
| Cache / queue backend | Redis | 8.x |
| Queues | BullMQ | 6.x |
| Object storage | S3-compatible (MinIO locally) | — |
| Email | Resend | 6.x |
| Password hashing | Argon2id (`argon2`) | 0.45.x |
| Logging | Pino | 10.x |

### 5.4 Testing

| Layer | Tool |
| --- | --- |
| Unit | Vitest 5.x |
| Integration (API + DB) | Vitest + Testcontainers-style ephemeral Postgres |
| E2E | Playwright 1.63.x |
| Email rendering | React Email 6.x + snapshot tests |

Rationale for each significant choice lives in `docs/adr/`.

---

## 6. Repository structure

```text
/
├── apps/
│   ├── marketing/          Public website (SSG, SEO)
│   ├── dashboard/          Customer application
│   ├── admin/              Internal administration
│   ├── api/                NestJS modular monolith
│   └── worker/             BullMQ consumers + schedulers
│
├── packages/
│   ├── ui/                 Design system: tokens, primitives, patterns
│   ├── db/                 Prisma schema, client, migrations, seed
│   ├── auth/               Session, password, token primitives
│   ├── config/             Typed, validated environment loading
│   ├── types/              Shared domain types & enums
│   ├── validation/         Zod schemas shared by API and clients
│   ├── email/              EmailService abstraction + templates
│   ├── logger/             Pino setup, request/correlation IDs
│   ├── permissions/        RBAC policy definitions and evaluation
│   ├── api-client/         Typed API client used by dashboard & admin
│   ├── test-utils/         Factories, fixtures, DB harness
│   ├── eslint-config/      Shared lint configuration
│   └── tsconfig/           Shared TypeScript configurations
│
├── docs/
│   ├── architecture/       System and module design
│   ├── api/                Endpoint contracts, conventions
│   ├── database/           ERD, deletion strategy, indexing
│   ├── product/            Requirements, user journeys
│   ├── security/           Threat model, controls
│   ├── deployment/         Environments, runbooks
│   ├── adr/                Architecture Decision Records
│   └── diagrams/           Mermaid source diagrams
│
├── infrastructure/
│   ├── docker/             Dockerfiles, compose fragments
│   ├── scripts/            Operational scripts
│   └── migrations/         Data (not schema) migration scripts
│
└── <root documents>        See §7
```

Schema migrations live with Prisma in `packages/db/prisma/migrations`.
`infrastructure/migrations` is for one-off **data** backfills, which are code-reviewed,
idempotent and logged.

---

## 7. Document map

| Document | Answers |
| --- | --- |
| `INIT.md` | What are we building and with what? (this file) |
| `PRODUCT.md` | What must it do, for whom, and what is MVP? |
| `ARCHITECTURE.md` | How do the pieces fit together? |
| `DATABASE.md` | What is the data model and how is it kept safe? |
| `API.md` | What are the HTTP contracts and conventions? |
| `SECURITY.md` | What are the threats and controls? |
| `EMAILS.md` | How does mail get composed, queued, sent and tracked? |
| `UI_UX.md` | What does it look like and why? |
| `TESTING.md` | What do we test and how? |
| `DEPLOYMENT.md` | How does it run in production? |
| `ROADMAP.md` | In what order do we build it? |
| `TASKS.md` | What is the next unit of work? |
| `DECISIONS.md` | What did we decide, when, and why? |
| `CHANGELOG.md` | What changed for users? |
| `AGENTS.md` | Operating contract for any coding agent |
| `CLAUDE.md` | Claude-specific repository instructions |

---

## 8. Development philosophy

1. **Tenant isolation is a load-bearing wall.** Enforced in the data-access layer, not
   sprinkled through controllers. Tested explicitly. Never bypassed for convenience.
2. **The server owns computation.** Maintenance due-dates, fuel economy, costs and
   entitlements are computed server-side. Frontends render; they do not calculate.
3. **Controllers are thin.** HTTP concerns in controllers, business rules in services,
   persistence in repositories. Domain logic must be unit-testable without HTTP or a DB.
4. **History is sacred.** Vehicle history survives sale, archival and member removal.
   Destructive deletion is a deliberate, documented, audited operation.
5. **Strong typing end to end.** Zod schemas in `packages/validation` are the single
   source of truth shared by API validation and client forms.
6. **Idempotency by default.** Every job and every outbound email must be safe to retry.
7. **Documented decisions.** An architectural assumption that exists only in a chat log
   does not exist. It belongs in `DECISIONS.md` or an ADR.
8. **No unnecessary infrastructure.** New infrastructure requires an ADR justifying it.

---

## 9. SaaS model

Entitlements are designed from day one; billing is introduced later.

| Plan | Workspaces | Vehicles | Members | Storage | Notable |
| --- | --- | --- | --- | --- | --- |
| FREE | 1 | 2 | 1 | 100 MB | Basic reminders, 12-month history retention on exports |
| PRO | 3 | 10 | 3 | 5 GB | Advanced reports, exports, custom reminder policies |
| FAMILY | 1 | 8 | 6 | 5 GB | Shared garage focus |
| BUSINESS | 5 | 100 | 25 | 50 GB | Fleet mode, driver accounts, API access |

Numbers are initial defaults and live in the `plans` / `plan_features` tables, not in
code. Entitlement checks go through a single `EntitlementService`; components never
hardcode plan names. See `ARCHITECTURE.md` §11.

---

## 10. Deployment strategy

All five applications are containerised. A reverse proxy terminates TLS and routes by
hostname to marketing, dashboard, admin and API. The API talks to PostgreSQL, Redis and
S3-compatible object storage. The worker shares the same image family as the API and
consumes from Redis; it has no ingress.

No cloud-vendor-specific service is a hard dependency. Local development requires only
Docker: PostgreSQL, Redis and MinIO run in Compose. See `DEPLOYMENT.md`.

---

## 11. MVP boundary

**MVP ships:** accounts, personal workspaces, vehicles, odometer history, service
records with parts, maintenance rules and due computation, inspection/MOT, insurance,
road tax, expenses, documents, the reminder engine, in-app notifications, Resend email
with delivery tracking, and the admin tools needed to operate it.

**MVP defers (behind feature flags where partially built):** fuel analytics dashboards,
tyre management UI, warranty UI, workspace invitations, advanced reports, exports, real
billing, fleet mode, public API.

MVP is a scope boundary, not an excuse for weak engineering. Everything that ships,
ships to the Definition of Done in `AGENTS.md` §6.

---

## 12. Long-term scope

Granular per-vehicle member access; push, SMS and WhatsApp notification channels; a
PWA and then native mobile clients; a public developer API with API keys and scoped
tokens; government vehicle-data and VIN-decoder integrations; OBD/GPS telemetry ingest;
workshop and accounting integrations; data import from other trackers; localisation
(Romanian first); country-specific regulatory modules.

None of these are built now. All of them are shaped for now — see `ARCHITECTURE.md` §14.
