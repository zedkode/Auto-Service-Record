# DATABASE.md — Data Model

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20
**Engine:** PostgreSQL 18 · **ORM:** Prisma 7.10.x · **Schema:** `packages/db/prisma/schema.prisma`

The rendered ERD lives in `docs/database/erd.md`. This document explains the model, the
invariants and the rules that keep it correct.

---

## 1. Conventions

| Concern | Rule |
| --- | --- |
| Primary keys | UUID v7 (`uuid` column, time-ordered — index-friendly, non-enumerable) |
| Naming | `snake_case` tables and columns; plural table names; singular Prisma models |
| Timestamps | `created_at`, `updated_at` — `timestamptz`, always UTC |
| Soft delete | `deleted_at timestamptz NULL` on models that must survive deletion |
| Tenant key | `workspace_id uuid NOT NULL` on every tenant-owned table |
| Money | `numeric(14,2)` amount + `char(3)` ISO-4217 currency, always together |
| Distance | `integer` value + `distance_unit` enum, or canonical metres where computed |
| Calendar dates | `date` (no time, no timezone) for expiries and document dates |
| Enums | PostgreSQL native enums via Prisma `enum` |
| Booleans | Non-null with an explicit default |
| JSON | `jsonb`, only for genuinely open-ended data (metadata, external refs) |

---

## 2. Entity overview

```text
IDENTITY              TENANCY                VEHICLE CORE
users                 workspaces             vehicles
user_profiles         workspace_members      vehicle_images
sessions              workspace_invitations  odometer_entries
email_verification_   workspace_member_
  tokens                _vehicles (future)
password_reset_tokens

SERVICE & MAINTENANCE          OWNERSHIP                  CONTENT
service_categories             vehicle_inspections        documents
service_records                inspection_advisories      contacts
service_parts                  insurance_policies
maintenance_rules              road_tax_records
maintenance_events             warranties
                               tyre_sets
                               tyre_installations
                               fuel_entries
                               expense_categories
                               expenses

NOTIFICATION                   COMMERCIAL                 PLATFORM
reminders                      plans                      admin_users
notifications                  plan_features              audit_logs
notification_preferences       subscriptions              feature_flags
notification_deliveries        usage_counters             support_access_grants
email_messages                 feature_overrides          system_events
email_delivery_events
```

Approximately 45 tables. The list in the master brief was deduplicated: `maintenance_events`
was merged into `service_records` linkage plus a lightweight completion log, and
`background_job_metadata` was dropped — BullMQ owns job state in Redis, and only failures
worth operator attention are projected into `system_events`.

---

## 3. Tenant isolation at the database layer

Application-level scoping (`ARCHITECTURE.md` §4) is the first line. The database is the
last, and it does not depend on anyone remembering a `where` clause.

**Every tenant-owned table carries `workspace_id`**, including grandchildren such as
`service_parts`. This is deliberate denormalisation with a purpose:

```sql
-- parent exposes a composite unique for child references
ALTER TABLE vehicles ADD CONSTRAINT vehicles_id_workspace_uk
  UNIQUE (id, workspace_id);

-- child cannot reference a parent in a different workspace
ALTER TABLE service_records ADD CONSTRAINT service_records_vehicle_fk
  FOREIGN KEY (vehicle_id, workspace_id)
  REFERENCES vehicles (id, workspace_id) ON DELETE RESTRICT;
```

A bug that pairs vehicle A (workspace 1) with a service record claiming workspace 2 is
rejected by Postgres, not discovered by a customer. Composite FKs of this shape are
required on: `service_records`, `service_parts`, `odometer_entries`, `maintenance_rules`,
`vehicle_inspections`, `inspection_advisories`, `insurance_policies`, `road_tax_records`,
`warranties`, `tyre_installations`, `fuel_entries`, `expenses`, `documents`,
`vehicle_images`, `reminders`.

Prisma **does** express these natively as multi-field relations, so they live in
`schema.prisma` rather than in hand-written SQL:

```prisma
model OdometerEntry {
  vehicleId   String
  workspaceId String
  vehicle Vehicle @relation(
    fields: [vehicleId, workspaceId],
    references: [id, workspaceId],
    onDelete: Restrict
  )
}
```

The parent declares `@@unique([id, workspaceId])`. The isolation suite asserts that every
tenant-owned child table has such a constraint, and proves it holds by attempting a
cross-workspace insert through raw SQL.

Constraints Prisma *cannot* express — partial unique indexes (the single-OWNER rule),
generated `tsvector` columns and functional indexes — are appended as hand-written SQL in
`migrations/20260920161500_tenancy_invariants/`.

Row-Level Security is intentionally **not** the primary mechanism (see ADR-002): the
application uses a single pooled connection identity, and per-request `SET LOCAL` role
switching interacts badly with connection pooling and Prisma's transaction model. The
extension-based scoping plus composite FKs give the same guarantee with far less
operational surprise. RLS remains available as a later hardening layer.

---

## 4. Core entities

### 4.1 users / user_profiles / sessions

```text
users
  id, email (citext unique), email_verified_at, password_hash, status,
  failed_login_count, locked_until, last_login_at, deleted_at, timestamps

user_profiles
  user_id (pk/fk), display_name, avatar_document_id, timezone (IANA),
  locale, preferred_distance_unit, preferred_currency, date_format

sessions
  id, user_id, token_hash (unique), user_agent, ip_hash, created_at,
  last_seen_at, expires_at, revoked_at, revoked_reason

email_verification_tokens / password_reset_tokens
  id, user_id, token_hash (unique), expires_at, consumed_at, created_at
```

`password_hash` is Argon2id. **Tokens are stored hashed** (SHA-256 of a
cryptographically random 32-byte value); the plaintext exists only in the email that was
sent. IP addresses are stored as a salted hash — enough to spot anomalies, not enough to
build a location history.

`users.status`: `ACTIVE | PENDING_VERIFICATION | SUSPENDED | DELETION_REQUESTED | DELETED`.

### 4.2 workspaces / workspace_members / workspace_invitations

```text
workspaces
  id, name, slug (unique), type, owner_user_id, default_currency,
  default_distance_unit, timezone, storage_used_bytes, deleted_at, timestamps

workspace_members
  id, workspace_id, user_id, role, status, invited_by_user_id,
  joined_at, timestamps            UNIQUE (workspace_id, user_id)

workspace_invitations
  id, workspace_id, email, role, token_hash (unique), invited_by_user_id,
  expires_at, accepted_at, revoked_at, timestamps
```

`workspaces.type`: `PERSONAL | FAMILY | BUSINESS | FLEET | CLUB | OTHER`.
`workspace_members.role`: `OWNER | ADMIN | EDITOR | DRIVER | VIEWER`.
`workspace_members.status`: `ACTIVE | INVITED | SUSPENDED | REMOVED`.

**Invariant:** exactly one `ACTIVE` `OWNER` per workspace, enforced by a partial unique
index and by an ownership-transfer procedure that runs in a single transaction.

```sql
CREATE UNIQUE INDEX workspace_single_owner
  ON workspace_members (workspace_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';
```

`workspace_member_vehicles (workspace_id, member_id, vehicle_id)` is created now and left
unused. When granular access ships, an empty set means "all vehicles" and a non-empty set
means "these only" — no migration of existing rows required.

### 4.3 vehicles

```text
vehicles
  id, workspace_id, manufacturer, model, generation, model_year, trim,
  registration_number, vin, engine_name, engine_code, displacement_cc,
  power_kw, fuel_type, transmission, drivetrain, body_type, colour,
  first_registered_on (date), purchased_on (date), purchase_odometer,
  purchase_odometer_unit, purchase_price, purchase_currency,
  sold_on (date), sale_price, sale_currency,
  current_odometer, current_odometer_unit, current_odometer_at (date),
  distance_unit, status, primary_image_id, notes, external_refs (jsonb),
  deleted_at, timestamps
```

`status`: `ACTIVE | STORED | SOLD | SCRAPPED | ARCHIVED`.
`fuel_type`: `PETROL | DIESEL | HYBRID | PLUGIN_HYBRID | ELECTRIC | LPG | CNG | HYDROGEN | OTHER`.
`transmission`: `MANUAL | AUTOMATIC | SEMI_AUTOMATIC | CVT | DCT | OTHER`.
`drivetrain`: `FWD | RWD | AWD | FOUR_WD | OTHER`.

`current_odometer` is a **cache** of the newest `odometer_entries` row, maintained in the
same transaction as any odometer write. It is never the source of truth.

`registration_number` is unique per workspace among non-deleted vehicles, not globally —
two workspaces may legitimately track the same vehicle (a sale, a shared family car):

```sql
CREATE UNIQUE INDEX vehicles_workspace_registration_uk
  ON vehicles (workspace_id, upper(registration_number))
  WHERE deleted_at IS NULL AND registration_number IS NOT NULL;
```

### 4.4 odometer_entries

```text
odometer_entries
  id, workspace_id, vehicle_id, value, unit, recorded_on (date),
  source, source_record_id, is_correction, correction_reason,
  created_by_user_id, notes, created_at
```

`source`: `MANUAL | SERVICE | FUEL | INSPECTION | IMPORT | API`.

Append-only: no updates, no deletes. A mistake is corrected by a new entry flagged
`is_correction` with a reason. `(vehicle_id, recorded_on DESC, value DESC)` is indexed
because every maintenance computation reads the latest entry.

### 4.5 service_records / service_parts / service_categories

```text
service_categories
  id, workspace_id (NULL = system category), key, name, description,
  default_interval_km, default_interval_months, is_system, sort_order

service_records
  id, workspace_id, vehicle_id, performed_on (date), odometer,
  odometer_unit, category_id, contact_id, mechanic_name, description,
  parts_total, labour_total, tax_total, total_amount, currency,
  warranty_months, warranty_distance, next_service_on (date),
  next_service_odometer, notes, created_by_user_id, deleted_at, timestamps

service_parts
  id, workspace_id, service_record_id, name, brand, manufacturer,
  part_number, quantity numeric(10,3), unit_price, currency,
  warranty_months, supplier_contact_id, notes, timestamps
```

System categories (`workspace_id IS NULL`) are seeded: engine oil, oil filter, air
filter, cabin filter, fuel filter, gearbox oil, brake fluid, coolant, steering fluid,
timing belt, timing chain, auxiliary belt, brakes, suspension, clutch, battery,
alternator, starter, DPF, EGR, turbo, tyres, wheel alignment. Workspaces may add their
own; `(workspace_id, key)` is unique with system rows treated as a shared namespace.

`total_amount` is the authoritative figure the user sees. `parts_total` and `labour_total`
are informational breakdowns and are **not** required to sum to the total — real invoices
include discounts and rounding.

### 4.6 maintenance_rules

```text
maintenance_rules
  id, workspace_id, vehicle_id, category_id, name,
  interval_distance, interval_distance_unit, interval_months,
  threshold_distance, threshold_days,
  last_completed_on (date), last_completed_odometer, last_completed_unit,
  last_service_record_id, next_due_on (date), next_due_odometer,
  status, is_active, is_user_overridden, notes, timestamps
```

`status` (`OK | DUE_SOON | DUE | OVERDUE`) and the `next_due_*` columns are **computed and
persisted** by the server — persisted so the scheduler can find due items with an index
scan instead of evaluating every rule nightly. They are recomputed on: service creation,
odometer entry, rule edit, and the nightly sweep.

At least one of `interval_distance` or `interval_months` must be set:

```sql
ALTER TABLE maintenance_rules ADD CONSTRAINT maintenance_rules_interval_ck
  CHECK (interval_distance IS NOT NULL OR interval_months IS NOT NULL);
```

### 4.7 Ownership modules

```text
vehicle_inspections
  id, workspace_id, vehicle_id, inspection_type, performed_on (date),
  expires_on (date), result, odometer, odometer_unit, contact_id,
  centre_name, certificate_number, notes, timestamps

inspection_advisories
  id, workspace_id, inspection_id, severity, text, is_resolved,
  resolved_service_record_id, timestamps

insurance_policies
  id, workspace_id, vehicle_id, contact_id, provider_name, policy_number,
  cover_type, starts_on (date), expires_on (date), premium_amount, currency,
  payment_frequency, renewal_type, excess_amount, coverage_notes, timestamps

road_tax_records
  id, workspace_id, vehicle_id, country_code, tax_type, reference,
  starts_on (date), expires_on (date), amount, currency, payment_frequency,
  notes, timestamps

warranties
  id, workspace_id, vehicle_id, warranty_type, provider_name, contact_id,
  reference, starts_on (date), expires_on (date), distance_limit,
  distance_limit_unit, start_odometer, start_odometer_unit, coverage_notes,
  service_record_id, service_part_id, created_by_user_id, deleted_at, timestamps
```

`inspection_type`: `MOT | ITP | TUV | CT | STATE_INSPECTION | EMISSIONS | OTHER`.
`result`: `PASS | PASS_WITH_ADVISORIES | FAIL | UNKNOWN`.
`warranty_type`: `MANUFACTURER | DEALER | THIRD_PARTY | PART | REPAIR`.
`tyre_season`: `SUMMER | WINTER | ALL_SEASON`. `tyre_set_status`: `IN_USE | STORED |
RETIRED`. `tyre_position`: `ALL_ROUND | FRONT_AXLE | REAR_AXLE | FRONT_LEFT | FRONT_RIGHT |
REAR_LEFT | REAR_RIGHT | SPARE`.

`tread_measured_on` was added during OWN-005: a depth with no date cannot be judged stale,
and a two-year-old reading shown beside a legal limit is worse than none. `removed_on` NULL
means the set is fitted now, and at most one such row may exist per vehicle — enforced in
the service rather than by a constraint, because fitting a set legitimately closes the
previous row in the same transaction (DECISIONS.md D-107/D-108). `start_odometer` was
added during OWN-004: without it `distance_limit` is ambiguous, meaning an absolute
odometer reading on a vehicle warranty but an allowance from the fitting reading on a part
or repair. There is deliberately **no** stored status column — a warranty's state depends
on the current odometer and is computed on every read (DECISIONS.md D-099/D-100).
`payment_frequency`: `ONE_OFF | MONTHLY | QUARTERLY | BIANNUAL | ANNUAL`.

`country_code` on `road_tax_records` keeps the model from being UK-shaped. Country-specific
rules are a later module; the storage is already neutral.

### 4.8 Tyres, fuel, expenses

```text
tyre_sets
  id, workspace_id, vehicle_id, name, manufacturer, model, size,
  season, load_index, speed_rating, purchased_on (date),
  purchase_price, currency, notes, status, timestamps

tyre_installations
  id, workspace_id, tyre_set_id, vehicle_id, position,
  installed_on (date), installed_odometer, removed_on (date),
  removed_odometer, odometer_unit, tread_depth_mm numeric(4,1),
  tread_measured_on (date), service_record_id, notes,
  created_by_user_id, timestamps

fuel_entries
  id, workspace_id, vehicle_id, filled_on (date), odometer, odometer_unit,
  quantity numeric(10,3), quantity_unit, total_amount, currency,
  unit_price, fuel_type, is_full_tank, is_partial_fill, station_name,
  contact_id, notes, created_by_user_id, timestamps

expense_categories
  id, workspace_id (NULL = system), key, name, is_system, sort_order

expenses
  id, workspace_id, vehicle_id (nullable), category_id, incurred_on (date),
  amount, currency, vendor_name, contact_id, odometer, odometer_unit,
  description, source_type, source_record_id, deleted_at, timestamps
```

`season`: `SUMMER | WINTER | ALL_SEASON`. `position`: `FRONT_LEFT | FRONT_RIGHT |
REAR_LEFT | REAR_RIGHT | SPARE`. `quantity_unit`: `LITRES | US_GALLONS | IMP_GALLONS | KWH`.

**Fuel economy** is computed tank-to-tank between consecutive full fills; partial fills
are accumulated into the next full-fill interval and never used as an interval endpoint
on their own. Electric vehicles use `KWH` and the same interval logic.

**Expense linkage:** `source_type` / `source_record_id` let a service, fuel entry,
insurance premium or tax payment project itself into the expense ledger without the user
entering it twice. Reports read `expenses` as the single cost surface, and must not
double-count a service both directly and via its projection — projections are the only
rows counted.

### 4.9 documents

```text
documents
  id, workspace_id, vehicle_id (nullable), uploaded_by_user_id,
  storage_key (unique), original_filename, content_type, byte_size,
  checksum_sha256, document_type, title, document_date (date),
  expires_on (date), attached_to_type, attached_to_id,
  status, scan_status, deleted_at, timestamps
```

`status`: `PENDING | AVAILABLE | QUARANTINED | DELETED`. Rows are created in `PENDING`
when an upload session is issued and promoted to `AVAILABLE` only after the object is
confirmed present, correctly sized and matching its declared checksum. Abandoned
`PENDING` rows and their orphaned objects are reaped nightly.

`storage_key` is `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}` — namespaced by
tenant and unguessable. Buckets are private; all access is via short-lived signed URLs
issued after a permission check.

### 4.10 Notifications and email

```text
reminders
  id, workspace_id, vehicle_id (nullable), source_type, source_id,
  target_user_id (nullable = all eligible members), title, body,
  due_on (date), due_odometer, due_odometer_unit,
  lead_days int[], channels notification_channel[],
  status, snoozed_until (date), completed_at, dismissed_at,
  last_evaluated_at, timestamps
  UNIQUE (workspace_id, source_type, source_id) WHERE status NOT IN ('COMPLETED','CANCELLED')

notifications
  id, workspace_id, user_id, category, title, body, action_url,
  vehicle_id, related_type, related_id, read_at, created_at

notification_preferences
  id, user_id, workspace_id, category, channel, is_enabled, timestamps
  UNIQUE (user_id, workspace_id, category, channel)

notification_deliveries
  id, workspace_id, notification_id, reminder_id, user_id, channel,
  idempotency_key (unique), status, email_message_id, attempts,
  last_error, created_at, delivered_at

email_messages
  id, workspace_id (nullable), user_id (nullable), template, locale,
  recipient_email, subject, provider, provider_message_id,
  status, correlation_id, idempotency_key (unique),
  created_at, sent_at, delivered_at, failed_at, last_event_at, metadata (jsonb)

email_delivery_events
  id, email_message_id, provider_event_id (unique), event_type,
  occurred_at, payload (jsonb), received_at
```

`email_messages.status`: `QUEUED | SENDING | SENT | DELIVERED | DELAYED | BOUNCED |
COMPLAINED | FAILED | SUPPRESSED`. Status only advances — a late `sent` webhook never
overwrites a `delivered` state. `provider_event_id` unique makes webhook replay safe.

### 4.11 Commercial

```text
plans              id, key (unique), name, description, is_public, sort_order, timestamps
plan_features      id, plan_id, key, value_int, value_bool, value_text  UNIQUE (plan_id, key)
subscriptions      id, workspace_id, plan_id, status, provider, provider_subscription_id,
                   current_period_start, current_period_end, cancel_at, cancelled_at, trial_ends_at
usage_counters     id, workspace_id, key, value, period_start, period_end, updated_at
                   UNIQUE (workspace_id, key, period_start)
feature_overrides  id, workspace_id, key, value_int, value_bool, expires_at, reason,
                   created_by_admin_id  UNIQUE (workspace_id, key)
```

Provider columns are nullable so the whole commercial model works with no billing
provider connected at all.

### 4.12 Platform

```text
admin_users            id, email (unique), password_hash, role, status, mfa_secret,
                       mfa_enrolled_at, last_login_at, failed_attempts, locked_until,
                       timestamps
admin_sessions         id, admin_user_id, token_hash (unique), ip_hash, user_agent,
                       expires_at, last_seen_at, revoked_at, created_at
audit_logs             id, workspace_id (nullable), actor_type, actor_user_id,
                       actor_admin_id, action, resource_type, resource_id,
                       ip_hash, user_agent, correlation_id, metadata (jsonb), created_at
support_access_grants  id, admin_user_id, workspace_id, reason, scope,
                       granted_at, expires_at, revoked_at, revoked_by,
                       use_count, last_used_at, timestamps
feature_flags          id, key (unique), description, is_enabled, rollout_percentage,
                       allowed_workspace_ids uuid[], timestamps
system_events          id, severity, source, event_type, message, correlation_id,
                       metadata (jsonb), created_at
```

`mfa_secret` is **encrypted, not hashed** — a hash cannot verify a rotating TOTP code, so
it is AES-256-GCM ciphertext under a key derived from the application secret. It is the
only credential in the schema that is reversible, and the only one that has to be
(DECISIONS.md D-064). Everything else — passwords, session tokens, reset tokens — is
hashed, because those are only ever compared.

`admin_sessions` is separate from `sessions` with its own 8-hour lifetime. The two
authentication realms share no table, no token and no guard (SECURITY.md §6).

`audit_logs` is append-only and **never** contains passwords, tokens, session IDs or
document contents. Metadata records changed field names and coarse before/after values
for non-sensitive fields only.

---

## 5. Deletion strategy

Three different operations that are often confused. Getting this wrong destroys exactly
the data the product exists to protect.

| Operation | Meaning | Mechanism |
| --- | --- | --- |
| **Archive** | No longer in use, history fully retained and readable | `status = ARCHIVED/SOLD` |
| **Soft delete** | Entered in error, hidden from all reads, recoverable | `deleted_at` set |
| **Hard delete** | Legally or contractually required removal | Row removed, audit retained |

Rules:

1. **A vehicle is never hard-deleted by a user action.** Selling sets `status = SOLD`;
   "delete" sets `deleted_at` and hides it. History rows are untouched in both cases.
2. **Foreign keys use `ON DELETE RESTRICT` by default.** Cascades are opt-in, per
   relationship, with a written reason. An accidental cascade that removes ten years of
   service history is unrecoverable from the application's point of view.
3. **Cascades are permitted only** where the child has no independent meaning:
   `service_parts` → `service_records`, `inspection_advisories` → `vehicle_inspections`,
   `email_delivery_events` → `email_messages`, `plan_features` → `plans`,
   `sessions`/`*_tokens` → `users`.
4. **Workspace deletion** is a queued, multi-step job: 30-day grace period with the
   workspace suspended and restorable, then object-storage purge, then row removal in
   dependency order, with audit records preserved (workspace ID retained, content not).
5. **Account deletion** is a distinct privacy workflow — see `SECURITY.md` §12. A user
   who owns a shared workspace must transfer ownership or explicitly delete the workspace
   first; deleting an account must never silently orphan other members' data.
6. **Document deletion** soft-deletes the row immediately, hides it from all reads, and
   removes the S3 object after the 30-day retention window via the cleanup queue.

---

## 6. Indexing

Baseline, created with the initial migration:

```sql
-- tenancy: the predicate on nearly every query
CREATE INDEX ON <every tenant table> (workspace_id);
CREATE INDEX ON <every vehicle-child table> (workspace_id, vehicle_id);

-- hot paths
CREATE INDEX ON odometer_entries (vehicle_id, recorded_on DESC, value DESC);
CREATE INDEX ON service_records (workspace_id, vehicle_id, performed_on DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX ON fuel_entries (workspace_id, vehicle_id, filled_on DESC);
CREATE INDEX ON expenses (workspace_id, incurred_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON expenses (workspace_id, category_id, incurred_on DESC);

-- the scheduler's queries: these decide whether the nightly sweep is a scan or a seek
CREATE INDEX ON maintenance_rules (status, next_due_on)
  WHERE is_active AND status <> 'OK';
CREATE INDEX ON maintenance_rules (workspace_id, vehicle_id, is_active);
CREATE INDEX ON reminders (status, due_on) WHERE status IN ('SCHEDULED','DUE','SNOOZED');
CREATE INDEX ON vehicle_inspections (expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX ON insurance_policies (expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX ON road_tax_records (expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX ON warranties (expires_on) WHERE expires_on IS NOT NULL;

-- notification centre
CREATE INDEX ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- email tracing
CREATE INDEX ON email_messages (workspace_id, created_at DESC);
CREATE INDEX ON email_messages (provider_message_id);
CREATE INDEX ON email_messages (status, created_at DESC);

-- lookups
CREATE UNIQUE INDEX ON sessions (token_hash);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX ON audit_logs (resource_type, resource_id, created_at DESC);
```

**Search** uses GIN trigram indexes (`pg_trgm`) on `vehicles.manufacturer`, `model`,
`registration_number` and `vin`. A generated `tsvector` column was tried first and
removed: Prisma Migrate cannot model a GENERATED column and repeatedly tried to drop it,
blocking every later migration (DECISIONS.md D-036). Trigrams give partial and fuzzy
matching, which is what registration and VIN lookup actually need.

---

## 7. Transactions

Operations that must be atomic:

- Registration → user + profile + personal workspace + OWNER membership + default
  notification preferences + FREE subscription.
- Service creation → service record + parts + odometer entry + maintenance rule
  advancement + expense projection + timeline consequence.
- Odometer write → entry insert + `vehicles.current_odometer` cache update.
- Ownership transfer → demote old OWNER + promote new OWNER (the partial unique index
  makes any non-atomic implementation fail loudly rather than silently).
- Document finalisation → status promotion + `workspaces.storage_used_bytes` increment +
  usage counter update.

Isolation level `READ COMMITTED` throughout; counter updates use
`UPDATE ... SET value = value + n` rather than read-modify-write.

---

## 8. Money

**Never floating point.** `numeric(14,2)` in Postgres, `Prisma.Decimal` in TypeScript,
string over the wire (JSON numbers are IEEE-754 doubles — `0.1 + 0.2` is a support ticket).

Every amount column is accompanied by a currency column. There is no implicit workspace
currency fallback at the row level: if a receipt was in EUR, it is stored in EUR.

Multi-currency reporting requires a conversion policy. It is **out of MVP scope**: reports
group by currency and refuse to sum across currencies rather than inventing a rate. When
conversion arrives, historical rates will be stored per transaction date, because
converting a 2019 invoice at today's rate is simply wrong.

---

## 9. Distance units

`MILES` and `KILOMETERS` are stored explicitly next to every distance value. They are
never compared or arithmetically combined without conversion.

- **Canonical internal unit for computation:** metres, as an integer.
- **Conversion:** `1 mile = 1609.344 m` exactly. Round half-up at the display boundary only.
- **Storage:** the value as the user entered it, plus its unit. The original reading is
  never rewritten into another unit — a service book that says 150,000 miles should still
  say that in ten years.
- **Display:** the user's preferred unit (`user_profiles.preferred_distance_unit`),
  falling back to the workspace default, falling back to the vehicle's own unit.
- **Types:** `packages/types` exports branded `Miles` and `Kilometers` types so mixing
  them is a compile error, not a runtime surprise.

---

## 10. Dates and time

Two genuinely different concepts, modelled differently on purpose:

| Concept | Type | Examples |
| --- | --- | --- |
| **Instant** | `timestamptz`, UTC | `created_at`, `sent_at`, `last_login_at` |
| **Calendar date** | `date` | `expires_on`, `performed_on`, `purchased_on` |

An MOT expiring on 2026-11-30 expires on that date everywhere. Storing it as a timestamp
means a user in UTC+13 sees it expire a day early. Calendar dates are `date` columns,
carried as `YYYY-MM-DD` strings in the API, and never passed through a timezone conversion.

Scheduling uses the user's IANA timezone from `user_profiles.timezone` to decide *when* to
send, while all stored timestamps remain UTC.

---

## 11. Migrations

- Prisma Migrate. `packages/db/prisma/migrations`, committed, reviewed, never edited once
  applied.
- Hand-written SQL is appended to the generated migration for composite FKs, partial
  unique indexes, generated columns and check constraints.
- Expand/contract for breaking changes: add nullable → backfill → switch reads → make
  non-null → drop old. Never a single migration that both adds a NOT NULL column and
  drops the one it replaced.
- Data backfills are separate, idempotent, re-runnable scripts in
  `infrastructure/migrations`, not migration side effects.
- `prisma migrate deploy` runs as a release step, never by the application at boot — two
  API replicas starting at once must not race each other to migrate.
