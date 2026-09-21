# API.md — HTTP API Design

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20
**Base URL:** `https://api.example.com/api/v1`
**OpenAPI:** served at `/api/v1/docs` (JSON at `/api/v1/docs-json`), non-production only

---

## 1. Principles

- **Versioned.** `/api/v1`. A breaking change means `/api/v2`, not a silent contract shift.
- **Resource-oriented.** Nouns in paths, verbs as HTTP methods.
- **Workspace-scoped.** Tenant resources live under `/workspaces/:workspaceId/...`. The
  tenant is in the path, visible in logs and impossible to forget.
- **Predictable.** One pagination style, one filter style, one error shape, everywhere.
- **Typed end to end.** Zod schemas in `packages/validation` generate both runtime
  validation and the TypeScript types used by `packages/api-client`.
- **Contract-documented.** Every endpoint carries OpenAPI metadata. Undocumented endpoints
  fail CI.

---

## 2. Conventions

### 2.1 Requests

- `Content-Type: application/json` for mutations. Multipart is not accepted — file bodies
  go directly to object storage via presigned URLs.
- `X-Request-Id` accepted and echoed; generated when absent.
- `X-CSRF-Token` required on cookie-authenticated mutations.
- `Idempotency-Key` accepted on `POST` for retry-safe creation.
- Dates: calendar dates as `YYYY-MM-DD`; instants as ISO-8601 UTC (`2026-09-20T14:23:00Z`).
- Money: `{ "amount": "129.99", "currency": "GBP" }` — amount is a **string**.
- Distance: `{ "value": 150000, "unit": "MILES" }`.

### 2.2 Responses

Single resource:

```json
{ "data": { "id": "0193...", "type": "vehicle", "...": "..." } }
```

Collection:

```json
{
  "data": [ { "id": "0193..." } ],
  "meta": { "total": 143, "limit": 25, "hasMore": true, "nextCursor": "eyJpZCI6..." }
}
```

`204 No Content` for deletes. The envelope is consistent so clients never branch on shape.

### 2.3 Status codes

| Code | Meaning |
| --- | --- |
| 200 | Success |
| 201 | Created (with `Location` header) |
| 204 | Deleted / no body |
| 400 | Malformed request |
| 401 | Not authenticated |
| 403 | Authenticated, permission denied **within a workspace you belong to** |
| 404 | Not found — **also returned for resources in workspaces you do not belong to** |
| 409 | Conflict (duplicate, state conflict, odometer regression) |
| 410 | Gone (expired invitation or upload session) |
| 413 | Payload too large |
| 422 | Validation failed |
| 402 | Plan limit reached |
| 429 | Rate limited (`Retry-After` header) |
| 500 | Server error (no detail leaked) |
| 503 | Dependency unavailable |

**404 over 403 across tenants is a security control, not a UX preference.** See
`SECURITY.md` §3.

---

## 3. Pagination

**Cursor-based** for timeline-shaped and large collections (default and recommended):

```http
GET /workspaces/:ws/vehicles/:id/services?limit=25&cursor=eyJpZCI6...
```

**Offset-based** for admin tables needing page numbers:

```http
GET /admin/users?page=3&perPage=50
```

Rules: `limit` default 25, maximum 100. Cursors are opaque base64 of the sort key plus
tie-breaker ID and must not be constructed by clients. Every paginated list has a
deterministic total order (the sort field plus `id`), so no row is skipped or repeated
across pages.

---

## 4. Filtering, sorting, search

```http
GET /workspaces/:ws/expenses
      ?vehicleId=0193...
      &categoryId=0194...
      &dateFrom=2026-01-01
      &dateTo=2026-09-30
      &minAmount=50
      &q=tyres
      &sort=-incurredOn
      &limit=50
```

- Filter keys are explicit per endpoint and documented in OpenAPI. No generic
  `filter[field][op]=value` query language — it is impossible to index and easy to abuse.
- `sort` takes a documented field, `-` prefix for descending. Only indexed fields are
  sortable.
- `q` is full-text search scoped to the endpoint's resource and always workspace-scoped.
- Unknown query parameters are rejected with `422`, not ignored — a typo in a filter
  silently returning everything is a data-leak-shaped bug.
- Frontends mirror filter state into URL query parameters so views are shareable and
  survive refresh.

---

## 5. Error format

Every error, from every endpoint:

```json
{
  "error": {
    "code": "VEHICLE_NOT_FOUND",
    "message": "Vehicle could not be found.",
    "requestId": "01930f7a-8c21-7b3e-9f44-2a1c5d8e0b77"
  }
}
```

With field-level detail for validation failures:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The request contains invalid fields.",
    "requestId": "01930f7a-...",
    "details": [
      { "field": "registrationNumber", "code": "TOO_LONG", "message": "Maximum 16 characters." },
      { "field": "purchasedOn", "code": "INVALID_DATE", "message": "Expected format YYYY-MM-DD." }
    ]
  }
}
```

And plan-limit context:

```json
{
  "error": {
    "code": "PLAN_LIMIT_REACHED",
    "message": "Your plan allows 2 vehicles.",
    "requestId": "01930f7a-...",
    "details": { "limitKey": "max_vehicles", "limit": 2, "current": 2, "upgradeTo": "PRO" }
  }
}
```

**Rules.** `code` is a stable `SCREAMING_SNAKE_CASE` identifier clients may branch on —
it is part of the contract. `message` is human-readable English, safe to display, and
never contains internal identifiers, SQL, stack traces or file paths. `requestId` is
always present and always matches the log correlation ID. In production, unexpected
exceptions become `INTERNAL_ERROR` with a generic message; the detail is logged, not sent.

### 5.1 Error code catalogue (initial)

```text
AUTH_*         UNAUTHENTICATED, INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED,
               ACCOUNT_LOCKED, ACCOUNT_SUSPENDED, SESSION_EXPIRED,
               TOKEN_INVALID, TOKEN_EXPIRED, TOKEN_ALREADY_USED
WORKSPACE_*    WORKSPACE_NOT_FOUND, NOT_A_MEMBER, PERMISSION_DENIED,
               OWNER_REQUIRED, CANNOT_MODIFY_OWNER, LAST_OWNER,
               INVITATION_EXPIRED, ALREADY_A_MEMBER
VEHICLE_*      VEHICLE_NOT_FOUND, DUPLICATE_REGISTRATION, VEHICLE_ARCHIVED
ODOMETER_*     ODOMETER_REGRESSION, ODOMETER_FUTURE_DATE, ODOMETER_UNIT_MISMATCH
SERVICE_*      SERVICE_NOT_FOUND, INVALID_CATEGORY, CURRENCY_MISMATCH
MAINTENANCE_*  RULE_NOT_FOUND, INTERVAL_REQUIRED, RULE_INACTIVE
DOCUMENT_*     DOCUMENT_NOT_FOUND, UNSUPPORTED_FILE_TYPE, FILE_TOO_LARGE,
               UPLOAD_SESSION_EXPIRED, CHECKSUM_MISMATCH, DOCUMENT_QUARANTINED
REMINDER_*     REMINDER_NOT_FOUND, INVALID_TRANSITION
PLAN_*         PLAN_LIMIT_REACHED, FEATURE_NOT_AVAILABLE
GENERIC        VALIDATION_FAILED, RATE_LIMITED, CONFLICT, INTERNAL_ERROR,
               SERVICE_UNAVAILABLE, NOT_IMPLEMENTED
```

---

## 6. Endpoint map

Authentication is required unless marked **public**. Tenant endpoints additionally require
membership and the listed permission.

### 6.1 Auth — `/auth`

```text
POST   /auth/register                 public   create account + personal workspace
POST   /auth/login                    public   create session
POST   /auth/logout                            revoke current session
POST   /auth/verify-email             public   consume verification token          [done]
POST   /auth/verify-email/resend               re-send verification                [done]
POST   /auth/forgot-password          public   issue reset token (uniform response) [done]
POST   /auth/reset-password           public   consume reset token, revoke sessions [done]
GET    /auth/session                           current user + memberships
```

### 6.2 Users — `/users`

```text
GET    /users/me                               profile + preferences
PATCH  /users/me                               name, timezone, locale, units, currency
POST   /users/me/change-password               requires current password
POST   /users/me/change-email                  requires re-verification
GET    /users/me/sessions                      active sessions
DELETE /users/me/sessions/:id                  revoke one
DELETE /users/me/sessions                      revoke all others
GET    /users/me/notification-preferences
PUT    /users/me/notification-preferences
POST   /users/me/deletion-request               start deletion workflow
DELETE /users/me/deletion-request                cancel it
```

### 6.3 Workspaces — `/workspaces`

```text
GET    /workspaces/:ws                      workspace:read
GET    /workspaces/:ws/dashboard            workspace:read
GET    /workspaces/:ws/members              workspace:read

PATCH  /workspaces/:ws/members/:memberId    member:update_role   { role }
DELETE /workspaces/:ws/members/:memberId    member:remove
POST   /workspaces/:ws/members/leave        any member
POST   /workspaces/:ws/members/transfer-ownership  OWNER only
       { memberId, confirm: "TRANSFER" }

GET    /workspaces/:ws/invitations          member:invite
POST   /workspaces/:ws/invitations          member:invite  { email, role }
DELETE /workspaces/:ws/invitations/:id      member:invite

GET    /invitations/preview?token=…         public
POST   /invitations/accept                  authenticated  { token }
```

**Several routes declare a coarse permission and re-check it against the target.**
"An ADMIN may change a role" is true in general and false when the target is the OWNER, so
the service evaluates `can(role, permission, { targetRole })` after loading the member. A
route decorator cannot express it.

**Roles are `ADMIN | EDITOR | DRIVER | VIEWER`.** `OWNER` is not assignable: it is reached
only through a transfer, which requires the literal string `TRANSFER` as confirmation
because it cannot be undone without the other person's cooperation.

**Invariants that are refused with 422:** removing the owner, the owner leaving, changing
the owner's role directly, changing your own role, inviting an existing member.
Ownership transfer under contention returns **409** — the partial unique index guarantees
one winner (DECISIONS.md D-071).

**Invitations** carry a token that exists only in the email; the database holds its
SHA-256 hash and the API never returns it. They expire after 7 days, a second invitation
to the same address supersedes the first, and **acceptance requires a session whose email
matches the invitation** — otherwise forwarding the email would be an access grant
(D-073). Accepted, revoked, expired and forged tokens are all refused identically as
`TOKEN_INVALID` (D-072).

### 6.4 Vehicles — `/workspaces/:ws/vehicles`

```text
GET    .../vehicles                            list + filters + search
POST   .../vehicles                            vehicle:create (entitlement-checked)
GET    .../vehicles/:id                        vehicle:read
PATCH  .../vehicles/:id                        vehicle:update
DELETE .../vehicles/:id                        vehicle:delete (soft)
POST   .../vehicles/:id/archive                vehicle:update
POST   .../vehicles/:id/restore                vehicle:update
GET    .../vehicles/:id/summary                dashboard card payload
GET    .../vehicles/:id/timeline               merged chronological events
GET    .../vehicles/:id/images
POST   .../vehicles/:id/images                 links a finalised document
DELETE .../vehicles/:id/images/:imageId
PUT    .../vehicles/:id/images/:imageId/primary
```

`GET /vehicles/:id/timeline` merges services, inspections, insurance, tax, fuel, expenses,
odometer entries, tyre changes, purchase and sale into a single cursor-paginated,
reverse-chronological stream of `{ occurredOn, type, title, odometer, amount, refType, refId }`.

### 6.5 Odometer, services, maintenance

> **Implemented as of this release.** Paths below are relative to
> `/api/v1/workspaces/:workspaceId`.
>
> ```text
> GET    /service-categories                       system + workspace categories
> GET    /services                                 filters: vehicleId, categoryId,
>                                                  dateFrom, dateTo, q
> GET    /services/:serviceId
> PATCH  /services/:serviceId
> DELETE /services/:serviceId                      soft delete, audited
> GET    /vehicles/:id/services
> POST   /vehicles/:id/services                    creates service + parts + odometer
>                                                  entry + maintenance advance, atomically
> GET    /vehicles/:id/services/cost-summary       totals grouped by currency
>
> GET    /maintenance/due                          workspace-wide, worst first
> GET    /vehicles/:id/maintenance                 rules with server-computed state
> POST   /vehicles/:id/maintenance
> POST   /vehicles/:id/maintenance/apply-template  seed from category defaults
> PATCH  /maintenance/:ruleId
> DELETE /maintenance/:ruleId
> POST   /maintenance/:ruleId/complete             appends a completion, advances the rule
> GET    /maintenance/:ruleId/completions
> ```
>
> Maintenance status, next-due date and next-due odometer are **computed and returned by
> the server**. Clients render them and never recompute.


```text
GET    .../vehicles/:id/odometer                history
POST   .../vehicles/:id/odometer                odometer:write (409 on regression)
GET    .../vehicles/:id/odometer/current        derived current reading + freshness

GET    .../vehicles/:id/services                filters: category, date range, q
POST   .../vehicles/:id/services                service:write (creates parts + odometer + expense)
GET    .../services/:serviceId
PATCH  .../services/:serviceId
DELETE .../services/:serviceId                  soft delete, audited
GET    .../service-categories                   system + workspace custom
POST   .../service-categories
PATCH  .../service-categories/:id
DELETE .../service-categories/:id               409 if in use

GET    .../vehicles/:id/maintenance              rules + computed state
POST   .../vehicles/:id/maintenance              create rule
POST   .../vehicles/:id/maintenance/apply-template  seed from category defaults
PATCH  .../maintenance/:ruleId                   override interval/threshold
DELETE .../maintenance/:ruleId
POST   .../maintenance/:ruleId/complete          manual completion
GET    .../maintenance/due                       workspace-wide due/overdue
```

### 6.6 Ownership modules

```text
.../vehicles/:id/inspections          GET POST      + /:id GET PATCH DELETE
.../inspections/:id/advisories        GET POST      + /:id PATCH DELETE
.../vehicles/:id/insurance            GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/tax                  GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/warranties           GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/tyres                GET POST      + /:id GET PATCH DELETE
.../tyre-sets/:id/installations       GET POST      + /:id PATCH DELETE
.../vehicles/:id/fuel                 GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/fuel/statistics      GET           economy, cost/distance, trend
.../expenses                          GET POST      workspace-wide, vehicle filter
.../expenses/:id                      GET PATCH DELETE
.../expense-categories                GET POST      + /:id PATCH DELETE
.../contacts                          GET POST      + /:id GET PATCH DELETE
```


**As built (OWN-001/002/003).** Inspections, insurance and road tax are implemented:

```text
GET    /workspaces/:ws/inspections               ?vehicleId=
GET    /workspaces/:ws/inspections/:id
POST   /workspaces/:ws/vehicles/:vehicleId/inspections
PATCH  /workspaces/:ws/inspections/:id
DELETE /workspaces/:ws/inspections/:id           soft delete
PATCH  /workspaces/:ws/advisories/:id            { isResolved, resolvedServiceRecordId? }

GET    /workspaces/:ws/insurance-policies        ?vehicleId=
POST   /workspaces/:ws/vehicles/:vehicleId/insurance-policies
PATCH  /workspaces/:ws/insurance-policies/:id
DELETE /workspaces/:ws/insurance-policies/:id    soft delete

GET    /workspaces/:ws/road-tax                  ?vehicleId=
POST   /workspaces/:ws/vehicles/:vehicleId/road-tax
PATCH  /workspaces/:ws/road-tax/:id
DELETE /workspaces/:ws/road-tax/:id              soft delete
```

Reads require `ownership:read`, writes `ownership:write`. Every response carries a
server-computed expiry state, so no client does date arithmetic:

```json
{ "expiryStatus": "EXPIRING_SOON", "daysRemaining": 10, "expiresOn": "2026-10-01" }
```

`expiryStatus` is `EXPIRED | EXPIRING_SOON | VALID | NONE`; `NONE` means no expiry was
recorded, which is not the same as an expired one.

**Monetary fields are absent, not null, for a caller without `expense:read`.** A DRIVER
receives `providerName` and `expiresOn` but no `premiumAmount`, `excessAmount`, `amount`,
`currency` or `paymentFrequency` (ARCHITECTURE.md §5.1 note 3). Clients must treat a
missing field as "not visible to you", never as "not recorded".

Deleting is always a soft delete: an inspection certificate number may be the only record
its owner has.

**Expenses (OWN-007/008).**

```text
GET    /workspaces/:ws/expense-categories
GET    /workspaces/:ws/expenses            ?vehicleId= &categoryId= &dateFrom= &dateTo= &sourceType=
GET    /workspaces/:ws/expenses/summary    ?from= &to=   (defaults to month-to-date)
POST   /workspaces/:ws/expenses
PATCH  /workspaces/:ws/expenses/:id        MANUAL rows only
DELETE /workspaces/:ws/expenses/:id        MANUAL rows only, soft delete
```

Reads require `expense:read`, writes `expense:write`.

`expenses` is the **single cost surface**. A service, insurance premium or tax payment
projects itself into it, so a report reads this one table and never adds service records
to it separately — that would count the same service twice (DATABASE.md §4.8). The
projection is keyed on `(sourceType, sourceRecordId)`, which is unique, so editing a
service updates the row it already owns.

A projected row carries `isProjected: true` and a `sourceType` other than `MANUAL`.
`PATCH` and `DELETE` on one return **422** naming the record to edit instead: changing a
derived figure here would be reverted the moment its source changed.

An amount that is blank or zero projects nothing — "not recorded" is not a cost of zero
(DECISIONS.md D-056).

**Currencies are never summed.** `GET /expenses/summary` and the dashboard both return
`mixedCurrencies: true` with a null total when the period contains more than one currency;
the platform holds no exchange rates, so a single figure would be invented (D-054).

```json
{ "total": "1367.50", "currency": "GBP", "mixedCurrencies": false, "entries": 4,
  "byCategory": [ { "key": "servicing", "name": "Servicing & repairs", "total": "525.00", "count": 1 } ],
  "byVehicle":  [ { "vehicleId": "…", "name": "Ford Mondeo", "total": "1367.50", "count": 4 } ] }
```

### 6.7 Documents

**As built (DOC-101…106).**

```text
GET    /workspaces/:ws/documents                     ?vehicleId= &attachedToType= &attachedToId=
POST   /workspaces/:ws/documents/upload-session      → { documentId, upload: { url, method, headers, expiresInSeconds } }
POST   /workspaces/:ws/documents/:id/finalise        verifies the bytes, then publishes
GET    /workspaces/:ws/documents/:id/download        → { url, expiresInSeconds }
PATCH  /workspaces/:ws/documents/:id
DELETE /workspaces/:ws/documents/:id                 soft delete
```

Reads require `document:read`, writes `document:write`, deletion `document:delete`.

**Files never pass through this API.** The client uploads straight to object storage with
a presigned PUT valid for 15 minutes, then calls `finalise`; downloads are presigned GETs
valid for 5 minutes, issued only after the row has been found inside the caller's
workspace (DECISIONS.md D-060).

Three calls, because the bytes arrive somewhere the API does not control:

1. **`upload-session`** validates the *declared* file — allow-listed content type, allowed
   extension, the two agreeing with each other, and size within 20 MB — then creates a
   `PENDING` row and returns the presigned PUT. The declared SHA-256 is recorded now and
   checked later.
2. **`finalise`** verifies the object exists, is the declared size, *starts with the magic
   bytes of its declared type*, and matches the declared checksum. Only then does the row
   become `AVAILABLE`. Any mismatch sets `QUARANTINED` and returns **422** (D-061).
3. **`download`** returns a URL, not bytes, with `Content-Disposition: attachment` and the
   original filename restored.

**Nothing but `AVAILABLE` is ever served.** `PENDING` and `QUARANTINED` documents return
**404** from `download` and are absent from listings. Cross-tenant access is also 404, not
403 — whether a document exists in another workspace is not ours to confirm.

**The storage key is never returned.** It is the only address of the object and is
deliberately unguessable: `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}`, with the
original filename kept as metadata only (D-059).

**Allow-list:** `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
SVG is refused — it is XML that executes script, so serving one from our own origin would
be a stored-XSS vector.

`scanStatus` is `SKIPPED` on a verified upload, not `CLEAN`: no malware scanner is
configured, and saying `CLEAN` would claim an inspection that never happened (D-062).

### 6.8 Reminders and notifications

```text
GET    .../reminders                           filters: status, vehicle, source, due range
POST   .../reminders                           custom reminder
PATCH  .../reminders/:id                       due date, threshold, channels, lead days
POST   .../reminders/:id/snooze                { until } or { days }
POST   .../reminders/:id/dismiss
POST   .../reminders/:id/complete
DELETE .../reminders/:id                       custom reminders only

GET    /notifications                          across workspaces, unread first
GET    /notifications/unread-count
POST   /notifications/:id/read
POST   /notifications/read-all
```

### 6.9 Reports and dashboard

```text
GET    .../dashboard                           counts, attention items, recent activity
GET    .../reports/costs                       by category / vehicle / month, date-ranged
GET    .../reports/vehicles/:id/ownership      total cost, cost per distance, breakdown
GET    .../reports/fuel                        economy trends per vehicle
GET    .../reports/maintenance                 due / overdue across the workspace
POST   .../exports                             async export job → 202 + job id   (P2)
GET    .../exports/:id                         status + signed download when ready (P2)
```

### 6.10 Admin — `/admin` (separate auth realm)

**As built (ADMIN-001/002, SEC-017).**

```text
POST   /admin/auth/login        { email, password, totpCode } → sets as_admin_session
POST   /admin/auth/logout
GET    /admin/auth/session      → { admin, permissions }
POST   /admin/auth/mfa/confirm  { code } — completes enrolment

GET    /admin/metrics           admin:metrics:read
GET    /admin/queues            admin:queues:read
GET    /admin/emails            admin:email:read      ?status= &recipient= &limit=
GET    /admin/emails/stats      admin:email:read
GET    /admin/suppressions      admin:email:read      ?includeReleased=true
POST   /admin/suppressions/release  admin:email:manage
GET    /admin/audit             admin:audit:read      ?limit=
```

**Two factors, both mandatory.** Login takes a password *and* a TOTP code in one request;
there is no intermediate state in which the password alone has achieved anything. An
account that has not completed enrolment cannot sign in at all (SECURITY.md §13).

**This realm is disjoint from the customer one.** Separate table (`admin_users`), separate
session store (`admin_sessions`), separate cookie (`as_admin_session`, scoped to
`/api/v1/admin`), separate guard, separate RBAC matrix. A customer session is not valid
here and an admin session is not valid on customer routes — both are tested.

**Every response to an unauthenticated caller is 404**, never 401: the administrative
surface does not confirm its own existence to a prober (DECISIONS.md D-065). The admin app
reads a 404 as "sign in again".

**A route without an explicit `@RequireAdmin(...)` is refused**, even to a valid session,
so a forgotten permission is a visible failure rather than an open endpoint (D-066).

Sessions last 8 hours. Sign-in, sign-in failure, sign-out and enrolment all write
`audit_logs` rows with `actor_type = ADMIN` and `actor_admin_id` set.

Accounts are created with `node scripts/create-admin.mjs <email> <role>`, which prints the
password and enrolment URI once. There is no development bypass: the same path is used in
every environment.

**Support access and workspace inspection (SEC-018 / ADMIN-004), as built.**

```text
GET    /admin/workspaces/:id                 admin:workspaces:read — metadata, no grant needed
GET    /admin/workspaces/:id/vehicles        + a VEHICLE_CONTENT or FULL grant
GET    /admin/workspaces/:id/documents       + a DOCUMENTS or FULL grant — metadata only

POST   /admin/support-access                 admin:support_access:request
       { workspaceId, reason, scope, hours }
GET    /admin/support-access                 admin:support_access:read  ?includeExpired=true
DELETE /admin/support-access/:id             own grant, or admin:support_access:revoke
```

`/admin/workspaces/:id` returns counts and owner status — enough for most support without
touching anything private. The two endpoints below it return customer content and are
**404 without a live grant**, whatever the caller's role: no admin permission grants
content access, so seniority is not a way in.

A grant needs a reason of at least 20 characters, a scope, and 1–24 hours. Requesting one
twice returns the live grant rather than stacking a second.

**Every use writes an audit row**, and so does every refusal (`support_access.denied`).
The grant carries `useCount` and `lastUsedAt`. `isActive` and `minutesRemaining` are
computed server-side so the console cannot disagree about what is live.

Document responses carry metadata only — no storage key, no download URL (DECISIONS.md
D-070).

**Still to build** (Phase 9 target, all behind the same realm):

```text
GET    /admin/users            /admin/users/:id
POST   /admin/users/:id/suspend                reason required
POST   /admin/users/:id/reactivate
GET    /admin/workspaces       /admin/workspaces/:id
GET    /admin/vehicles                         aggregate counts and search only
GET    /admin/emails/:id
GET    /admin/email-events
GET    /admin/jobs             /admin/jobs/failed
POST   /admin/jobs/:queue/:id/retry
GET    /admin/system-events
GET    /admin/health
GET    /admin/plans            PATCH /admin/plans/:id
GET    /admin/subscriptions    PATCH /admin/subscriptions/:id
GET    /admin/feature-flags    PATCH /admin/feature-flags/:key
POST   /admin/support-access                   request grant (reason, scope, duration)
DELETE /admin/support-access/:id               revoke
```

Reading a customer's vehicle content or document metadata requires a
`support_access_grant`, which is why no admin permission grants it outright.

### 6.11 Webhooks and health

```text
POST   /webhooks/resend                        public, signature-verified
GET    /health                                 liveness-ish, always cheap
GET    /health/live
GET    /health/ready                           dependency checks
```

`/webhooks/resend` verifies the Svix signature over the **raw** body before trusting
anything in it, rejects timestamps older than five minutes, and treats a replayed event id
as a no-op. An invalid signature returns **401** — here the endpoint's existence *is*
public knowledge, since the provider is configured with the URL, so a clear status helps
whoever is debugging the integration and hides nothing.

It always answers 200 with a body saying what it did, so the provider does not retry an
event already handled:

```json
{ "data": { "processed": true, "advanced": true, "suppressed": false } }
```

`processed: false` carries a `reason` (`malformed`, `no_message_id`, `unknown_message`,
`duplicate`). Events for a message we have no record of are recorded as audit rows rather
than discarded — usually a race between our send transaction and a fast webhook, but a
pattern worth seeing.

Processing is **synchronous**, not queued behind a 202 as `SEC-013` originally specified:
the work is two indexed writes, and answering only after they commit is what makes the
duplicate and suppression outcomes reportable in the response.

---

## 7. Idempotency

`POST` endpoints accept an `Idempotency-Key` header. The key, the endpoint and a hash of
the request body are stored for 24 hours with the response. A repeat with the same key
returns the stored response; a repeat with the same key but a different body returns
`409 CONFLICT`. Internally-generated work (jobs, emails) uses the deterministic keys
described in `ARCHITECTURE.md` §8.

---

## 8. OpenAPI

Generated from NestJS decorators plus Zod schemas. Every endpoint declares its summary,
tags, request and response schemas, and its possible error codes. CI fails when a route
exists without OpenAPI metadata, when a documented schema drifts from its Zod source, or
when a response shape changes without a version bump. `packages/api-client` is generated
from the emitted spec, so the client cannot drift from the server.

---

## 9. Versioning and deprecation

`v1` is additive-only: new optional fields and new endpoints are non-breaking. Removing a
field, narrowing a type, changing an error code or changing pagination semantics requires
`v2`. Deprecated endpoints return a `Deprecation` header and a `Sunset` date, and are
supported for at least 6 months after `v2` ships.
