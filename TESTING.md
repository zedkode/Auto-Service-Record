# TESTING.md — Testing Strategy

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20
**Unit/integration:** Vitest 5.x · **E2E:** Playwright 1.63.x

---

## 1. Philosophy

Test what breaks and what would be expensive to get wrong. In this product that is, in
order: **tenant isolation**, **money**, **distance**, **dates**, and **the maintenance and
reminder engines**. A missed pixel is a bug report; a mileage calculation that is silently
wrong destroys the reason the product exists.

We do not chase a coverage percentage. We require coverage of specific things.

```text
        ╱╲          E2E — a dozen critical journeys
       ╱──╲         Integration — API + real Postgres, the bulk of confidence
      ╱────╲        Unit — pure domain logic, exhaustive and fast
     ╱──────╲
```

The middle layer is deliberately the widest. A vehicle-management API is mostly
"correct data in, correct data out, for the right tenant" — that is an integration
concern, and mocking the database away would test the mocks.

---

## 2. What must be tested

**Mandatory — a change touching these without tests is not Done:**

| Area | Why |
| --- | --- |
| Tenant isolation | Critical security boundary (§4) |
| Permissions | Every role × every permission |
| Maintenance due calculation | The core value of the product |
| Odometer regression rules | Silent data corruption otherwise |
| Distance conversion | Miles/km mixing is invisible until it is expensive |
| Money arithmetic | Rounding and currency errors are unforgivable |
| Fuel economy | Unit-dependent, easy to get subtly wrong |
| Reminder state machine | Duplicate or missed reminders both erode trust |
| Email idempotency | Retries must not email a user five times |
| Entitlement enforcement | Under-enforcing gives the product away; over-enforcing blocks paying customers |
| Auth flows | Registration, verification, login, reset, session revocation |
| Webhook signature verification | Forged events would corrupt delivery state |

---

## 3. Unit tests

Pure functions, no I/O, milliseconds. `packages/*/src/**/*.test.ts` and
`apps/api/src/**/*.spec.ts` for domain services.

Priority targets:

```text
maintenance engine    combined rules, whichever-first, thresholds, overdue,
                      stale odometer, missing data, leap years, month-end arithmetic
distance              miles↔km round-trips, rounding at display boundary, branded types
money                 Decimal arithmetic, no float leakage, currency mismatch rejection
fuel economy          mpg (imperial and US), L/100km, kWh/100km, partial-fill handling,
                      cost per mile/km, single-entry and out-of-order cases
permissions           full role × permission matrix, OWNER protections
entitlements          limit resolution order: override → subscription → plan → default
reminder policy       lead windows, snooze, dismissal, window key generation
dates                 calendar-date handling across timezones, DST boundaries
```

**Table-driven and exhaustive.** The maintenance engine has a fixture table of ~40 cases
covering every combination of {time-only, distance-only, combined} × {fresh, stale,
unknown odometer} × {not due, due soon, due, overdue}. This is the cheapest insurance in
the codebase.

Rule: a bug found in these areas gets a failing test reproducing it **before** the fix.

---

## 4. Integration tests

Real PostgreSQL, real Prisma, real NestJS app instance, real Redis. No database mocks.

**Harness** (`packages/test-utils`): each suite runs against an ephemeral database created
from the committed migrations. Between tests, tables are truncated (fast) rather than the
schema being rebuilt (slow). Tests run in parallel against separate schemas.

```ts
// packages/test-utils/src/harness.ts  (design sketch)
const ctx = await createTestContext()       // app + db + redis + MemoryTransport
const alice = await ctx.factory.user()
const wsA   = await ctx.factory.workspace({ owner: alice })
const car   = await ctx.factory.vehicle({ workspace: wsA })
```

Factories exist for every entity, produce valid data by default, and accept partial
overrides. A test that needs "a vehicle with an overdue oil service" says exactly that.

Coverage: every endpoint's happy path, validation failures, permission denials, pagination
and filtering, transactional consistency (a failed service creation leaves no orphan
odometer entry), and queue interactions.

### 4.1 The isolation suite — `pnpm test:isolation`

The most important test file in the repository.

It is **generated from the Prisma schema**: every model carrying `workspaceId` is
enumerated automatically, so a new tenant-owned model cannot be quietly omitted. For each
model and each of list, read, update and delete, it asserts that a member of workspace A
receives `404` for a resource in workspace B.

It additionally asserts:

- every tenant-owned child table has the composite `(id, workspace_id)` foreign key,
- the tenant Prisma extension injects `workspaceId` for every operation type,
- `$unscoped()` appears nowhere outside `modules/admin` and `apps/worker`,
- every route has an explicit `@RequirePermission` or `@Public` decorator,
- a direct-object-reference attempt with a valid UUID from another tenant returns 404,
  never 403.

**A failure here blocks merge unconditionally.** There is no "fix it in the next PR".

---

## 5. Email tests

No test may reach Resend. `MemoryTransport` is the default when `NODE_ENV=test`, and
`ResendTransport` throws at construction in that environment. CI additionally greps the
test tree for `ResendTransport` and fails if it appears.

```text
render          every template × representative props → non-empty HTML and text,
                absolute CTA URLs, no unresolved placeholders, snapshot stability
dispatch        preferences honoured; critical templates bypass them;
                suppressed addresses recorded as SUPPRESSED, not dropped
idempotency     same key twice → one email_messages row;
                concurrent duplicate jobs → one send
retry           transport failure retries with backoff, no duplicate on success
webhook         valid signature accepted; invalid rejected 401;
                replayed provider_event_id is a no-op;
                status rank never regresses (delivered → sent is ignored)
timezone        a user in UTC+13 and one in UTC-8 both receive at 09:00 local
quiet hours     a reminder due at 23:00 local is sent the next morning
```

---

## 6. End-to-end tests

Playwright, against the real stack in Docker, Chromium plus one WebKit run for the
critical path.

**E2E-1 — The core journey (mandatory):**

```text
register → receive verification email (Mailpit) → verify → login
  → personal workspace exists automatically
  → create vehicle → add odometer reading → add service record
  → maintenance rule advances and shows correct next-due
  → create reminder → in-app notification appears
  → reminder email is captured by the test transport
```

**E2E-2 — Cross-tenant access (mandatory security test):**

```text
User A creates workspace A with vehicle V
User B registers, creates workspace B
User B requests /workspaces/{A}/vehicles/{V}        → 404
User B requests /workspaces/{A}/vehicles            → 404
User B requests V's document download URL           → 404
User B attempts to PATCH V                          → 404
User B attempts to guess V's UUID in their own ws   → 404
```

This test exists because it is the failure the product cannot survive.

**Additional E2E:** onboarding with skipped steps; document upload → download → delete;
plan limit reached → correct 402 and upgrade prompt; workspace invitation → accept →
correct role enforcement; admin login isolated from customer session; password reset
revoking all sessions; mobile viewport navigation at 360 px.

**Accessibility:** `axe-core` runs against the dashboard's key screens in the same suite.
New violations fail the build.

---

## 7. Test data

- **Deterministic.** Seeded faker; no random values that make a failure unreproducible.
- **Realistic.** A vehicle has a plausible registration, mileage and service history.
  Fixtures of `test1`/`test2` hide formatting and layout bugs.
- **Never real.** No real registrations, VINs, email addresses, names or documents in
  fixtures — `@example.com` only.
- **Time-controlled.** Anything date-dependent uses an injectable clock. A test that
  passes today and fails on 1 January is worse than no test.

---

## 8. Commands

```bash
pnpm test                    # unit + integration, all packages
pnpm test:unit               # unit only, no infrastructure needed
pnpm test:integration        # requires docker compose up
pnpm test:isolation          # tenant isolation suite
pnpm test:e2e                # Playwright
pnpm test:watch              # watch mode
pnpm test --filter api       # one workspace package
pnpm test:coverage           # coverage report
```

`pnpm test:unit` must run with **no Docker, no database and no network**, so the fast
feedback loop stays fast.

---

## 9. CI gates

Every pull request:

```text
install → format:check → lint → typecheck → test:unit → build
        → test:integration (ephemeral Postgres + Redis)
        → test:isolation
        → test:e2e (critical journeys only)
        → audit (pnpm audit + secret scan)
```

Blocking: any failure in lint, typecheck, unit, integration, isolation, or a
high-severity dependency advisory. The isolation suite and E2E-2 are non-negotiable.

Nightly: full E2E matrix, accessibility sweep, Lighthouse on the marketing site.

`main` must remain deployable at all times.

---

## 10. What we deliberately do not test

- Third-party library internals.
- Exact pixel rendering — visual regression is deferred until the design system is stable;
  brittle snapshots that everyone re-baselines teach people to ignore failures.
- Trivial getters, DTO passthroughs and generated Prisma code.
- Framework behaviour (that NestJS routes, that React renders).

Tests exist to catch our mistakes, not to demonstrate that other people's code works.
