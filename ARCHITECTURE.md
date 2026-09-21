# ARCHITECTURE.md — System Architecture

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20

Formal decisions live in `docs/adr/`. This document describes the resulting system.

---

## 1. System overview

```text
                        ┌──────────────────┐
                        │  Reverse proxy   │  TLS, routing by hostname
                        └────────┬─────────┘
          ┌──────────────┬───────┴───────┬──────────────┐
          │              │               │              │
    www.example.com  app.example.com  admin.example.com  api.example.com
     ┌────────┐      ┌──────────┐     ┌─────────┐     ┌──────────────┐
     │marketing│     │dashboard │     │  admin  │     │     API      │
     │  (SSG) │      │  (SPA)   │     │  (SPA)  │     │  NestJS +    │
     └────────┘      └────┬─────┘     └────┬────┘     │   Fastify    │
                          └────────────────┴─────────>└──────┬───────┘
                                                             │
                        ┌────────────────┬───────────────────┼─────────────────┐
                        │                │                   │                 │
                 ┌──────▼─────┐   ┌──────▼─────┐      ┌──────▼─────┐   ┌───────▼──────┐
                 │ PostgreSQL │   │   Redis    │      │ S3 storage │   │    Resend    │
                 └──────▲─────┘   └──────▲─────┘      └──────▲─────┘   └───────▲──────┘
                        │                │                   │                 │
                        └────────────────┴──────┬────────────┴─────────────────┘
                                                │
                                        ┌───────▼────────┐
                                        │     Worker     │  BullMQ consumers
                                        │  (no ingress)  │  + repeatable schedulers
                                        └────────────────┘
```

**API and worker share the domain layer** (`packages/db`, `packages/email`,
`packages/permissions`) but are separate processes with separate scaling and separate
failure domains. A slow email provider cannot slow down an HTTP request.

---

## 2. Monorepo

pnpm workspaces for dependency resolution; Turborepo for task orchestration and caching.

**Dependency direction is strictly one-way:** apps depend on packages; packages depend on
packages; nothing depends on an app. `apps/dashboard` importing from `apps/admin` is a
build error, not a code-review comment.

```text
apps/*  ──────────────────────────────┐
                                      ▼
packages/api-client ──► packages/validation ──► packages/types
packages/ui ─────────► packages/types
packages/auth ───────► packages/db, packages/config, packages/logger
packages/email ──────► packages/config, packages/logger, packages/types
packages/permissions ► packages/types            (pure — no I/O, no DB)
packages/db ─────────► packages/config, packages/logger
packages/config ─────► (zod only)
packages/logger ─────► (pino only)
```

`packages/permissions` and `packages/validation` are **pure**: no database, no network,
no environment access. That makes them trivially testable and safe to ship to the
browser.

### 2.1 Package responsibilities

| Package | Owns | Never contains |
| --- | --- | --- |
| `ui` | Design tokens, primitives, patterns | Data fetching, business rules |
| `db` | Prisma schema, client, tenant guard, repositories, seeds | HTTP concerns |
| `auth` | Password hashing, token generation/verification, session logic | Route handlers |
| `config` | Zod-validated env loading per app | Secrets |
| `types` | Domain enums, DTO types, branded units | Runtime logic |
| `validation` | Zod request/response schemas | DB access |
| `email` | `EmailService`, templates, renderers, provider adapters | Business decisions |
| `logger` | Pino instance, redaction, correlation ID plumbing | Domain logic |
| `permissions` | Role → permission matrix, policy evaluation | I/O |
| `api-client` | Typed fetch client generated against the API contract | UI |
| `test-utils` | Factories, DB harness, fixtures | Production code |

---

## 3. API: modular monolith

NestJS on the Fastify adapter. One module per bounded context. Modules expose services;
they never reach into another module's repositories.

```text
apps/api/src/
├── main.ts
├── app.module.ts
├── common/
│   ├── filters/          global exception filter → standard error envelope
│   ├── interceptors/     correlation id, response shaping, audit emission
│   ├── pipes/            Zod validation pipe
│   ├── guards/           SessionGuard, WorkspaceGuard, PermissionGuard, AdminGuard
│   ├── decorators/       @CurrentUser @CurrentWorkspace @RequirePermission
│   └── pagination/       cursor + offset helpers
└── modules/
    ├── auth/             registration, login, sessions, verification, reset
    ├── users/            profile, preferences, sessions list, account deletion
    ├── workspaces/       workspaces, members, invitations, settings
    ├── vehicles/         vehicles, images, status lifecycle
    ├── odometer/         odometer entries, current mileage derivation
    ├── services/         service records, categories, parts
    ├── maintenance/      rules, due-state engine, completion linkage
    ├── inspections/      inspections, advisories
    ├── insurance/        policies
    ├── tax/              road tax / registration records
    ├── warranty/         warranties
    ├── tyres/            tyre sets, installations
    ├── fuel/             fuel entries, consumption calculation
    ├── expenses/         expenses, categories
    ├── documents/        upload sessions, signed URLs, metadata
    ├── contacts/         workshops, suppliers, insurers
    ├── reminders/        reminder CRUD and lifecycle transitions
    ├── notifications/    in-app notifications, preferences
    ├── reports/          aggregation queries
    ├── entitlements/     plans, limits, usage counters
    ├── admin/            platform admin endpoints (separate auth realm)
    ├── webhooks/         Resend ingestion (signature-verified, unauthenticated)
    └── health/           /health, /health/live, /health/ready
```

### 3.1 Request pipeline

```text
Fastify
 → correlationId (generate or accept x-request-id)
 → rate limiter
 → SessionGuard          resolve session cookie → user, or 401
 → WorkspaceGuard        resolve workspace from path/header → membership, or 403/404
 → PermissionGuard       @RequirePermission vs role matrix, or 403
 → EntitlementGuard      plan limits for create operations, or 402
 → ZodValidationPipe     parse and narrow the request
 → Controller            HTTP only
 → Service               business rules
 → Repository            workspace-scoped Prisma access
 → Response interceptor  envelope + serialisation
 → Exception filter      domain error → standard error format
```

A guard that cannot resolve a workspace returns **404, not 403**, when the caller is not
a member. Returning 403 confirms that the resource exists in another tenant.

---

## 4. Tenant isolation

Three layers, each independently sufficient to fail safe. Defence in depth, because a
single missed `where` clause is the highest-severity bug this product can ship.

**Layer 1 — Request context.** `WorkspaceGuard` resolves the workspace from the route
(`/api/v1/workspaces/:workspaceId/...`) and verifies an active `workspace_members` row
for the current user. The resolved `{ userId, workspaceId, role }` is attached to the
request as an immutable context object.

**Layer 2 — Scoped data access.** Tenant-owned models are never accessed through the raw
Prisma client from a service. They go through a scoped client created per request:

```ts
// packages/db/src/tenant-client.ts (design sketch)
export function forWorkspace(prisma: PrismaClient, workspaceId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_OWNED_MODELS.has(model)) return query(args)
          if (READ_OPS.has(operation) || WRITE_OPS.has(operation)) {
            args.where = { ...(args.where ?? {}), workspaceId }
          }
          if (CREATE_OPS.has(operation)) {
            args.data = { ...(args.data ?? {}), workspaceId }
          }
          return query(args)
        },
      },
    },
  })
}
```

`TENANT_OWNED_MODELS` is derived from the Prisma DMMF: **any model with a `workspaceId`
field is automatically tenant-owned.** Adding a model with `workspaceId` opts it into
protection without anyone remembering to register it.

**Layer 3 — Database constraints.** Child rows carry a denormalised `workspace_id` and a
composite foreign key back to the parent `(id, workspace_id)`, so the database itself
rejects a child pointing at a parent in another workspace. See `DATABASE.md` §3.

**Escape hatch.** Platform admin and system jobs legitimately cross workspaces. They use
an explicitly named `prisma.$unscoped()` accessor that is (a) greppable, (b) blocked by
lint rule outside `modules/admin` and `apps/worker`, and (c) audited when used against
customer data.

**Proof.** `pnpm test:isolation` asserts, for every tenant-owned model, that a member of
workspace A receives 404 for a resource in workspace B across read, update and delete.
The suite is generated from the Prisma schema so new models cannot be forgotten.

---

## 5. Authorisation (RBAC)

Two **completely separate** systems that never share a table, a token or a code path.

### 5.1 Workspace roles (customers)

| Permission | OWNER | ADMIN | EDITOR | DRIVER | VIEWER |
| --- | :-: | :-: | :-: | :-: | :-: |
| workspace:read | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspace:update | ✓ | ✓ | — | — | — |
| workspace:delete | ✓ | — | — | — | — |
| workspace:billing | ✓ | — | — | — | — |
| member:invite | ✓ | ✓ | — | — | — |
| member:update_role | ✓ | ✓¹ | — | — | — |
| member:remove | ✓ | ✓¹ | — | — | — |
| vehicle:read | ✓ | ✓ | ✓ | ✓² | ✓ |
| vehicle:create | ✓ | ✓ | ✓ | — | — |
| vehicle:update | ✓ | ✓ | ✓ | — | — |
| vehicle:delete | ✓ | ✓ | — | — | — |
| service:read | ✓ | ✓ | ✓ | ✓² | ✓ |
| service:write | ✓ | ✓ | ✓ | — | — |
| odometer:write | ✓ | ✓ | ✓ | ✓² | — |
| ownership:read | ✓ | ✓ | ✓ | ✓³ | ✓ |
| ownership:write | ✓ | ✓ | ✓ | — | — |
| fuel:write | ✓ | ✓ | ✓ | ✓² | — |
| expense:read | ✓ | ✓ | ✓ | — | ✓ |
| expense:write | ✓ | ✓ | ✓ | — | — |
| document:read | ✓ | ✓ | ✓ | ✓² | ✓ |
| document:write | ✓ | ✓ | ✓ | — | — |
| document:delete | ✓ | ✓ | — | — | — |
| reminder:manage | ✓ | ✓ | ✓ | — | — |
| report:read | ✓ | ✓ | ✓ | — | ✓ |

¹ ADMIN cannot modify or remove an OWNER. ² DRIVER is scoped to assigned vehicles once
granular access ships; until then DRIVER sees all workspace vehicles but cannot see
financial data (purchase price, expenses, reports).

³ A DRIVER can read inspection, insurance and road-tax records because driving a vehicle
whose MOT or cover has lapsed is an offence, and withholding that would be a safety
failure rather than a privacy win. The **money** on those records — premium, excess, tax
amount — is omitted from the response for any role without `expense:read`, so note 2 still
holds. The filter is server-side; the fields are absent, not nulled, so a client cannot
mistake "hidden" for "not recorded" (DECISIONS.md D-050).

Rules: exactly one OWNER per workspace at all times; ownership transfer is an explicit,
audited operation; the last member of a workspace cannot leave without deleting or
transferring it.

### 5.2 Admin roles (internal)

| Role | Capability |
| --- | --- |
| SUPER_ADMIN | Everything, including admin user management and feature flags |
| OPERATIONS | Queues, jobs, email delivery, system health, feature flags (read) |
| SUPPORT | User/workspace lookup, audited support access, no financial mutation |
| BILLING | Plans, subscriptions, usage; no document or vehicle content access |
| READ_ONLY | Read-only dashboards and metrics |

**No admin role can read a customer's private documents without an audited support
access grant** (reason required, time-boxed, logged). Passwords are never retrievable by
anyone.

### 5.3 Evaluation

`packages/permissions` is a pure function:

```ts
can(role: WorkspaceRole, permission: Permission, ctx?: PermissionContext): boolean
```

The same module powers the API guard and the frontend's affordance-hiding. The frontend
use is **cosmetic only** — the server decides.

---

## 6. Maintenance engine

Owned entirely by the server. Lives in `apps/api/src/modules/maintenance/engine/` as
pure functions over plain inputs, so it can be tested exhaustively without a database.

**Inputs:** rule (interval distance + unit, interval months, thresholds), last completion
(date + odometer), current odometer (value + unit + reading date), average daily distance
(derived from odometer history), and now.

**Outputs:**

```ts
type MaintenanceStatus = 'OK' | 'DUE_SOON' | 'DUE' | 'OVERDUE'

interface MaintenanceState {
  status: MaintenanceStatus
  nextDueDate: CalendarDate | null
  nextDueOdometer: Distance | null
  distanceRemaining: Distance | null
  daysRemaining: number | null
  triggeringDimension: 'DATE' | 'DISTANCE' | null   // which one fired first
  projectedDueDate: CalendarDate | null             // distance projected onto time
  odometerConfidence: 'FRESH' | 'STALE' | 'UNKNOWN'
}
```

**Rules.** For a combined rule, the effective due point is whichever dimension is reached
first. `DUE_SOON` is entered at the configured threshold (default: 30 days or 500 miles /
800 km before due). `OVERDUE` is past due. All distance arithmetic happens in a canonical
unit (metres, integer) and is converted only for display.

**Odometer confidence** matters: a distance-based rule computed from a six-month-old
reading is a guess. When the latest reading is older than 45 days the state is marked
`STALE`, the UI says so, and the reminder copy asks the user to update their mileage
rather than asserting a precise remaining distance.

**Completion.** Saving a service whose category matches a rule advances that rule's
`lastCompletedAt` / `lastCompletedOdometer` and recomputes the next due point. Users may
also complete a rule manually.

---

## 7. Odometer

`odometer_entries` is **append-only**. The vehicle's `currentOdometer` is a cached
derivation of the newest entry, recomputed inside the same transaction as any write.

- Entries are created by manual input, services, fuel entries, inspections and imports.
- A value lower than the latest entry is rejected by default (`ODOMETER_REGRESSION`).
- A correction is possible with `allowRegression: true`, which requires a reason, is
  audited, and marks the entry `isCorrection`.
- Genuine cluster replacement is modelled by an offset entry, not by rewriting history.

---

## 8. Reminder engine

One engine, many sources. Adding a source must not require changing the engine.

```ts
interface ReminderSource {
  type: ReminderSourceType    // MAINTENANCE | INSPECTION | INSURANCE | TAX |
                              // WARRANTY | DOCUMENT | SERVICE | TYRE | CUSTOM
  scan(ctx: ScanContext): Promise<ReminderCandidate[]>
}
```

Each source knows how to find its own due-dated objects; the engine owns scheduling,
deduplication, state transitions and delivery dispatch.

```text
Scheduler (worker, hourly)
  → for each timezone bucket whose local time is the send hour
      → for each source: scan() → candidates
      → upsert reminders (natural key: workspace + source type + source id + window)
      → transition SCHEDULED → DUE where threshold reached
      → create in-app notification
      → enqueue email job with idempotency key
```

**State machine:**

```text
SCHEDULED ──threshold reached──► DUE ──delivered──► SENT
    │                             │                   │
    │                             ├──user snoozes──► SNOOZED ──elapses──► DUE
    │                             ├──user dismisses──► DISMISSED
    │                             └──source resolved──► COMPLETED
    └──source deleted / vehicle archived──► CANCELLED
```

**Mileage-based reminders** are evaluated on the same schedule but also opportunistically
re-evaluated whenever a new odometer entry arrives for the vehicle — that is the moment
the user's data actually changed, and waiting until tomorrow's batch would be worse.

**Idempotency.** Every delivery carries a stable key:

```text
sha256(workspaceId | reminderId | channel | recipientId | windowKey)
```

where `windowKey` identifies the notification window (e.g. `due-30d`, `due-7d`,
`overdue-weekly-2026-W38`). A retried worker computes the same key and the unique index
on `notification_deliveries.idempotency_key` makes the duplicate a no-op.

---

## 9. Notifications

```text
Domain event / scheduler
        │
        ▼
NotificationService.dispatch(notification, channels)
        │
        ├──► IN_APP  ─► notifications table (immediate, synchronous)
        └──► EMAIL   ─► BullMQ `emails` queue ─► Worker ─► EmailService ─► Resend
                                                              │
                                                              ▼
                                                    email_messages (+ events)
```

Channels are a list, not a branch. `PUSH`, `SMS` and `WHATSAPP` are declared in the
`NotificationChannel` enum from day one and simply have no registered transport yet;
adding one is a new transport implementation plus a preference row, with no change to
the reminder engine.

**Preferences** are per user, per workspace, per category, per channel. Transactional and
security messages (email verification, password reset, security alerts, ownership
changes) are **not** subject to preferences and cannot be disabled.

---

## 10. Email

See `EMAILS.md` for the full design. Architecturally:

- `packages/email` exposes `EmailService`, never the Resend SDK, to the rest of the code.
- Providers implement a `MailTransport` interface: `ResendTransport` (production),
  `SmtpTransport` (local, pointed at Mailpit), `MemoryTransport` (tests).
- Templates are React Email components rendering HTML **and** a plain-text alternative.
- Every send writes an `email_messages` row *before* the provider call, so an outbound
  message is never invisible to support.
- `/api/v1/webhooks/resend` verifies the Svix-style signature, then appends to
  `email_delivery_events` and advances `email_messages.status`.

---

## 11. Entitlements

```ts
interface EntitlementService {
  limit(workspaceId: string, key: LimitKey): Promise<number | null>  // null = unlimited
  usage(workspaceId: string, key: LimitKey): Promise<number>
  check(workspaceId: string, key: LimitKey, delta?: number): Promise<EntitlementResult>
  feature(workspaceId: string, key: FeatureKey): Promise<boolean>
}
```

Resolution order: `feature_overrides` (per workspace) → `subscriptions` → `plan_features`
→ plan defaults. Limits are enforced by `EntitlementGuard` on create operations, which
returns `402 PAYMENT_REQUIRED` with the limit, current usage and an upgrade hint.

`usage_counters` are maintained transactionally with the operation that changes them and
reconciled nightly, because a counter that drifts either blocks paying customers or gives
away the product.

**Frontends never hardcode plan names.** They read entitlements from
`GET /api/v1/workspaces/:id/entitlements` and render from that.

---

## 12. Background jobs

BullMQ on Redis. Queues:

| Queue | Purpose | Retries | Backoff |
| --- | --- | --- | --- |
| `notifications` | Reminder scanning, notification fan-out | 5 | exponential, 30 s base |
| `emails` | Render + send | 5 | exponential, 60 s base |
| `documents` | Post-upload processing, thumbnails, virus scan hook | 3 | exponential |
| `reports` | Async report and export generation | 3 | exponential |
| `maintenance` | Due-state recomputation after data changes | 3 | exponential |
| `cleanup` | Expired tokens, orphaned uploads, log retention | 2 | fixed, 5 min |

Repeatable schedulers (defined once, in the worker):

| Schedule | Job |
| --- | --- |
| Hourly | Timezone-bucketed reminder scan |
| Daily 02:00 UTC | Expiry scan (inspection, insurance, tax, warranty, documents) |
| Daily 03:00 UTC | Usage counter reconciliation |
| Daily 04:00 UTC | Cleanup (expired tokens, abandoned upload sessions) |
| Weekly Mon 07:00 local | Optional weekly digest |
| Monthly 1st 07:00 local | Optional monthly ownership summary |

**Every job must be idempotent.** Jobs carry deterministic job IDs where possible so a
duplicate enqueue is absorbed by BullMQ rather than producing a duplicate side effect.
Failed jobs land in the failed set and surface in the admin app with payload (redacted),
error, attempt count and a retry action.

---

## 13. Observability

**Correlation.** Every request gets an `x-request-id` (accepted from the proxy or
generated). It flows into the logger context, into job payloads, into `email_messages`,
and into webhook processing, so one identifier traces:

```text
HTTP request → reminder → job → email → Resend → webhook
```

**Logging.** Pino, JSON, with a redaction list covering `password`, `token`, `secret`,
`authorization`, `cookie`, `set-cookie` and `apiKey`. Never log request bodies for auth
endpoints.

**Health.**
- `/health` — process is up.
- `/health/live` — event loop responsive; used by orchestrator liveness.
- `/health/ready` — dependency check (Postgres, Redis, S3 reachability) with per-check
  status; used by load-balancer readiness and by the admin System Health page.

**Metrics.** API request rate/latency/errors, queue depth and job failure rate, email
delivery and bounce rates, worker heartbeat, storage usage per workspace.

---

## 14. Designed-for extensibility

The following are **not built now** but are shaped for:

| Future capability | What makes it cheap later |
| --- | --- |
| Push / SMS / WhatsApp | `NotificationChannel` enum + transport interface already exist |
| Granular vehicle access | `workspace_member_vehicles` join table is in the ERD, unused |
| Public API | Auth is guard-based; adding an `ApiKeyGuard` alongside `SessionGuard` is additive |
| Government / VIN data | `vehicles.externalRefs` JSONB + a provider interface; never on the critical path |
| Mobile / PWA | API is stateless JSON; session cookie strategy has a bearer-token fallback |
| Billing provider | `subscriptions` abstracts the provider; provider IDs are nullable columns |
| Data import | `odometer_entries.source = IMPORT` and import batch IDs exist from the start |
| Localisation | All user-facing strings go through a message catalogue, not JSX literals |
| Service extraction | Modules communicate via services with explicit interfaces, not shared tables |

---

## 15. What we deliberately did not do

- **No microservices.** A modular monolith plus a worker serves 10,000+ users on modest
  hardware and can be split along existing module boundaries if it ever needs to be.
- **No GraphQL.** REST with OpenAPI is simpler to cache, document, secure and version for
  this domain. (ADR-003.)
- **No Elasticsearch.** PostgreSQL full-text search covers registration numbers, VINs,
  models, workshops and part numbers at this scale. (ADR-009.)
- **No event sourcing.** Append-only tables where history matters (odometer, audit,
  email events) give the benefit without the complexity.
- **No separate BFF per frontend.** One versioned API with consistent contracts; the
  admin surface is a separate module with a separate auth realm, not a separate service.
