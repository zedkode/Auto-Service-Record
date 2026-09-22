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
GET    .../vehicles?includeInactive=true       list; inactive hidden unless asked for
POST   .../vehicles                            vehicle:create (entitlement-checked)
GET    .../vehicles/deleted                    vehicle:read — the restore list
GET    .../vehicles/:id                        vehicle:read (works for inactive vehicles)
PATCH  .../vehicles/:id                        vehicle:update
PATCH  .../vehicles/:id/status                 vehicle:update — lifecycle transition
DELETE .../vehicles/:id                        vehicle:delete — soft, 204
POST   .../vehicles/:id/restore                vehicle:delete — undoes the soft delete
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

**Tyre sets (OWN-005).** A set is what you own; an installation is a period it spent on
the car. Every read computes `distance` — summed across **every** period the set has been
fitted, with the open one measured against the vehicle's current mileage — and `tread`,
from the most recent measurement. Neither is stored.

`distance` reports `miles`, `kilometres` and `metres`, plus `measuredPeriods` and
`unmeasuredPeriods`, so a total drawn from three of five fittings is visibly partial. It is
null with `NEVER_FITTED`, `NO_INSTALL_READING` or `NO_CURRENT_READING` when it cannot be
worked out.

`tread.state` is `GOOD`, `MONITOR`, `REPLACE_SOON`, `ILLEGAL` or `UNKNOWN`, against a
1.6 mm legal minimum and a 3.0 mm advisory depth, and is **never estimated from mileage**
(DECISIONS.md D-109). A reading older than 180 days is flagged `stale`.

`POST /tyre-sets/:id/fit` closes whatever was fitted, at the same date and odometer — a car
wears one set at a time (D-108). Fitting an already-fitted set, deleting one that is on the
car, or measuring tread on a stored set each return `409`.

**Warranties (OWN-004).** A warranty ends on a date **or** a mileage, whichever comes
first, so every read carries a computed `status`:
`{ state, governedBy, daysRemaining, distanceRemaining, cautions }`. `state` is `ACTIVE`,
`EXPIRING_SOON`, `EXPIRED`, `NOT_STARTED` or `UNKNOWN`; `governedBy` is `DATE` or
`DISTANCE` and names whichever clock ran out, or will run out first. It is computed against
the vehicle's current odometer on every request and **never stored** — a stored state is
wrong as soon as a reading is entered (DECISIONS.md D-099).

`distanceLimit` means an absolute odometer reading when `startOdometer` is null, and an
allowance measured from that reading when it is set: "60,000 miles" on a manufacturer
warranty against "12,000 miles" on a clutch fitted at 90,000 (D-100). A `PART` or `REPAIR`
warranty with no starting reading returns the caution `NO_START_ODOMETER`; a mileage limit
on a vehicle with no reading at all returns `NO_ODOMETER` and falls back to the date.
`distanceLimit` and `distanceLimitUnit` must be supplied together, as must `startOdometer`
and its unit — miles and kilometres are converted, never compared raw.

Warranties feed the reminder engine as source type `WARRANTY`. Unlike the other expiry
sources, each warranty is judged on its own rather than only the newest per vehicle, and an
ended one stops being reported after 90 days or a 5,000-unit mileage overrun (D-101).

**Vehicle history document (EXP-002).** `kind: 'VEHICLE_HISTORY'` produces one vehicle's
complete history as a PDF, for handing to a buyer (PRODUCT.md §4.4). It is the only kind
that is a document rather than a table, so it is refused unless `format` is `PDF` and a
`vehicleId` is given, and the tabular kinds are refused as `PDF` — both with `422` at
request time rather than as a job that fails after being accepted.

The document contains the vehicle's identity, every service with its parts, every
inspection **including outstanding advisories**, the full mileage log, warranties, a fuel
summary, and an index of attached documents by name and date. The files themselves are
never included and no storage key appears in it (DECISIONS.md D-106). Every page states
that it is an owner-entered record rather than a verified history (D-105).

**Data export (EXP-001).** `POST /workspaces/:ws/exports` takes
`{ kind, format, from?, to?, vehicleId? }` and returns **202** with the job row — it does
not wait for the file. `kind` is `EXPENSES`, `SERVICES`, `FUEL`, `ODOMETER` or `VEHICLES`;
`format` is `CSV` or `JSON`. Date filters are recorded only for the kinds they apply to.
Requires `export:create`, which VIEWER and DRIVER do not have (DECISIONS.md D-097); the
list and status endpoints need only `report:read`.

`GET /exports` and `GET /exports/:id` report `status` — `PENDING`, `RUNNING`, `READY`,
`FAILED` or `EXPIRED` — with `rowCount`, `byteSize`, `filename` and, on failure, a message
safe to show a user. At most 3 exports may be `PENDING` or `RUNNING` per workspace; a
fourth request returns `409`.

`POST /exports/:id/download` returns `{ url, expiresInSeconds, filename }`. It is a POST
because it mints a credential and writes an audit entry, so it must not be prefetched or
replayed from history. The URL is signed and lives for 120 seconds; the object key never
leaves the server. A download is refused with `409` when the export is not `READY`, and an
export whose file has been reaped is marked `EXPIRED` rather than signed for (D-095).

CSV files carry a UTF-8 BOM and CRLF line endings, and any cell beginning `=`, `+`, `-`,
`@`, tab or CR is prefixed with a single quote so no spreadsheet evaluates it (D-096).

**Fleet rollup (RPT-004).** `GET /workspaces/:ws/reports/fleet?from&to` returns the same
period as `/reports/costs`, arranged one row per vehicle:
`{ from, to, days, currency, mixedCurrencies, fleet, vehicles[], unassigned }`. Each row in
`vehicles` carries `total`, `share`, `distance`, `costPerDistance`, `costPerYear` and
`compliance`, and rows are sorted most expensive first. Every "cannot say" is explicit and
carries its reason — `ONE_READING`, `NO_MOVEMENT`, `PERIOD_TOO_SHORT`, `MIXED_CURRENCIES` —
using the same thresholds as the single-vehicle report, including the 90-day annualisation
floor.

`compliance` is `{ state, kind, expiresOn, daysRemaining }` where `state` is `EXPIRED`,
`DUE_SOON` (within 30 days), `OK` or `UNKNOWN`, and `kind` names whichever of `INSPECTION`,
`INSURANCE` or `TAX` lapses first. It is derived from the latest obligation record of each
kind, never from `reminders` (DECISIONS.md D-088). `UNKNOWN` means nothing is recorded and
is **not** a pass.

`unassigned` holds costs not attached to any vehicle. They count towards `fleet.total` but
are excluded from every per-vehicle figure, so the vehicle rows do not sum to the fleet
total when it is non-zero (D-089).

**Fuel economy trends (RPT-003).** `GET /vehicles/:id/fuel/trend` returns
`{ points, direction, changePercent, basis, cautions, unavailableReason, electric }`.
`points` is one entry per calendar month, keyed `YYYY-MM`, holding that month's distance,
quantity and consumption; an interval is attributed to the month its CLOSING fill falls in.
`direction` is `IMPROVING`, `WORSENING` or `STABLE`, and is **null** until six measured
months exist — `unavailableReason` then says which of `NO_INTERVALS`, `NOT_ENOUGH_MONTHS`
or `MIXED_ENERGY` applies. `changePercent` is the change in consumption per distance
(positive = using more), from the last three months against the three before, weighted by
distance. `cautions` may carry `SEASONAL_OVERLAP` (under a year of history, so some of the
change is the weather) or `SPARSE_DATA`. Clients render these; they never recompute them
(DECISIONS.md D-084 to D-086).

**Lifecycle.** `PATCH /vehicles/:id/status` takes `{ status, reason?, occurredOn? }` where
`status` is one of `ACTIVE`, `SOLD`, `SCRAPPED` or `ARCHIVED`. Moving out of `ACTIVE`
cancels the vehicle's open reminders ([D-083]); moving back to `ACTIVE` does not
resurrect them — the scheduler regenerates them from the inspection and policy dates.
Inactive vehicles are excluded from the garage list, the dashboard and cost reports, but
remain readable by id and appear under `?includeInactive=true`.

**Deletion is never destructive.** `DELETE /vehicles/:id` sets `deleted_at` and returns
`204`; nothing is removed. The vehicle disappears from every list and from every cost
total, and `GET /vehicles/deleted` then `POST /vehicles/:id/restore` bring it back with
its full history ([D-082]). The registration uniqueness index is partial
(`WHERE deleted_at IS NULL`), so deleting a vehicle frees its plate for immediate reuse.
If the plate has been reused, restoring the original returns `409 REGISTRATION_REUSED`
naming the vehicle that now holds it, and the original stays deleted. Workspace-level
erasure under GDPR is a separate operation.

`PATCH /status`, `DELETE` and `POST /restore` each write an audit entry
(`vehicle.status_changed`, `vehicle.deleted`, `vehicle.restored`).

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
.../vehicles/:id/insurance-policies    GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/road-tax             GET POST      + /:id GET PATCH DELETE
.../warranties                        GET           whole workspace, or ?vehicleId=
.../vehicles/:id/warranties           GET POST      + /warranties/:id GET PATCH DELETE
.../tyre-sets                         GET           whole workspace, or ?vehicleId=
.../vehicles/:id/tyre-sets            GET POST      + /tyre-sets/:id GET PATCH DELETE
.../tyre-sets/:id/fit                 POST          fits it, taking off whatever was on
.../tyre-sets/:id/remove              POST          ends the current fitting
.../tyre-sets/:id/tread               POST          records a measured depth
.../tyre-sets/:id/installations       GET POST      + /:id PATCH DELETE
.../vehicles/:id/fuel                 GET POST      + /:id GET PATCH DELETE
.../vehicles/:id/fuel/economy         GET           tank-to-tank consumption
.../vehicles/:id/fuel/trend           GET           monthly consumption + direction
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

**Fuel and consumption (OWN-006).**

```text
GET    /workspaces/:ws/vehicles/:id/fuel          vehicle:read
GET    /workspaces/:ws/vehicles/:id/fuel/economy  vehicle:read
POST   /workspaces/:ws/vehicles/:id/fuel          fuel:write
PATCH  /workspaces/:ws/fuel/:entryId              fuel:write
DELETE /workspaces/:ws/fuel/:entryId              fuel:write, soft delete
```

`fuel:write` is held by DRIVER, who is the person actually filling up.

**Consumption is measured tank to tank** (DECISIONS.md D-002). Only fills that filled the
tank can bound an interval; a partial fill is accumulated into the interval ending at the
next full one. `/economy` returns every measurable interval plus a distance-weighted
average (D-074), and when there is no figure it returns **why**:

```json
{ "average": null, "unavailableReason": "ONE_FULL_FILL", "intervals": [], "skipped": [] }
```

`unavailableReason` is `NO_FILLS | ONE_FULL_FILL | NO_USABLE_INTERVAL`. Intervals that
cannot be trusted are listed in `skipped` with a reason — `MISSED_FILL`, `NO_DISTANCE`,
`MIXED_ENERGY`, `NO_QUANTITY` — rather than silently dropped.

Electric vehicles record `KWH` and go through identical interval logic, reporting
`kwhPer100Km` and `milesPerKwh`; litre figures come back `null` rather than invented.
Litres and kWh are never summed in one interval (D-075).

**A fill is also a mileage reading**: it writes an odometer entry with `source = FUEL` and
updates the vehicle's current mileage (D-076). It also projects into the expense ledger,
completing the set of cost sources.

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

**As built (RPT-001/002).**

```text
GET /workspaces/:ws/reports/costs   report:read   ?from= &to= &vehicleId=
```

Defaults to year to date. `report:read` is deliberately absent from DRIVER, who sees no
financial data (ARCHITECTURE.md §5.1 note 2).

Reads `expenses` and nothing else for money — the single cost surface — so a service is
counted once through its projection rather than twice (DECISIONS.md D-058). Distance comes
from `odometer_entries`, which is append-only, so the mileage behind a per-mile figure is
evidence rather than a current-value snapshot.

```json
{ "total": "1470.00", "currency": "GBP", "mixedCurrencies": false, "entries": 6, "days": 365,
  "byCategory": [ { "key": "servicing", "name": "Servicing & repairs", "total": "600.00", "share": 40.82 } ],
  "byVehicle":  [ { "vehicleId": "…", "name": "Ford Mondeo", "total": "1470.00", "share": 100 } ],
  "byMonth":    [ { "month": "2026-01", "total": "0.00", "count": 0 } ],
  "distance": { "kilometres": 6000, "miles": 3728.23, "unavailableReason": null },
  "costPerDistance": { "perMile": "0.394", "perKilometre": "0.245", "unavailableReason": null },
  "costPerYear": { "amount": "1470.00", "projected": false, "unavailableReason": null } }
```

**Every month in the period gets a bucket**, including months with no spend: a chart with
missing months lies about the shape of spending.

**Shares are computed server-side** so a bar chart needs no arithmetic of its own.

**Distance is summed per vehicle**, never across them — two odometers are unrelated numbers
(D-077). Odometer corrections are excluded: a correction restates a reading rather than
recording travel.

**Figures that cannot be produced honestly are null with a reason**, never a dash:

| Field | `unavailableReason` | Meaning |
| --- | --- | --- |
| `distance`, `costPerDistance` | `NO_READINGS` | no mileage recorded in the period |
| | `ONE_READING` | a single reading cannot bound a distance |
| | `NO_MOVEMENT` | the mileage did not change |
| `costPerDistance`, `costPerYear` | `MIXED_CURRENCIES` | more than one currency (D-054) |
| `costPerYear` | `PERIOD_TOO_SHORT` | under 90 days; extrapolating lumpy costs would overstate the year (D-078) |

`costPerYear.projected` is true when the period is between 90 days and a year, so the UI
can say "at this rate" instead of stating it as fact.

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
