# Entity Relationship Diagram

**Version:** 1.1 · **Updated:** 2026-09-21

Split into six views for legibility. Field lists show keys and the columns that carry
meaning for relationships; see `DATABASE.md` §4 for complete definitions.

`WS` in a field list marks the `workspace_id` tenant key. Every table carrying it is
subject to the scoping rules in `ARCHITECTURE.md` §4 and the composite foreign keys in
`DATABASE.md` §3.

---

## 1. Identity and tenancy

```mermaid
erDiagram
    users ||--|| user_profiles : "has"
    users ||--o{ sessions : "opens"
    users ||--o{ email_verification_tokens : "requests"
    users ||--o{ password_reset_tokens : "requests"
    users ||--o{ workspace_members : "joins"
    workspaces ||--o{ workspace_members : "contains"
    workspaces ||--o{ workspace_invitations : "issues"
    workspaces ||--o{ vehicles : "owns"
    workspaces ||--|| subscriptions : "subscribes"
    users ||--o{ notification_preferences : "configures"

    users {
        uuid id PK
        citext email UK
        timestamptz email_verified_at
        text password_hash "argon2id"
        enum status
        int failed_login_count
        timestamptz locked_until
        timestamptz deleted_at
    }
    user_profiles {
        uuid user_id PK,FK
        text display_name
        text timezone "IANA"
        text locale
        enum preferred_distance_unit
        char preferred_currency
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text token_hash UK "sha256"
        text ip_hash
        timestamptz expires_at
        timestamptz revoked_at
    }
    workspaces {
        uuid id PK
        text name
        text slug UK
        enum type "PERSONAL|FAMILY|BUSINESS|FLEET|CLUB|OTHER"
        uuid owner_user_id FK
        char default_currency
        enum default_distance_unit
        text timezone
        bigint storage_used_bytes
        timestamptz deleted_at
    }
    workspace_members {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid user_id FK
        enum role "OWNER|ADMIN|EDITOR|DRIVER|VIEWER"
        enum status
        timestamptz joined_at
    }
    workspace_invitations {
        uuid id PK
        uuid workspace_id FK "WS"
        citext email
        enum role
        text token_hash UK
        timestamptz expires_at
        timestamptz accepted_at
    }
```

---

## 2. Vehicle core

```mermaid
erDiagram
    workspaces ||--o{ vehicles : "owns"
    vehicles ||--o{ vehicle_images : "shows"
    vehicles ||--o{ odometer_entries : "records"
    vehicles ||--o{ service_records : "has"
    vehicles ||--o{ maintenance_rules : "follows"
    vehicles ||--o{ documents : "stores"
    workspace_members }o--o{ vehicles : "workspace_member_vehicles (future)"

    vehicles {
        uuid id PK
        uuid workspace_id FK "WS"
        text manufacturer
        text model
        text generation
        int model_year
        text trim
        text registration_number "unique per workspace"
        text vin
        text engine_code
        int displacement_cc
        int power_kw
        enum fuel_type
        enum transmission
        enum drivetrain
        date first_registered_on
        date purchased_on
        numeric purchase_price
        char purchase_currency
        int current_odometer "cached"
        enum current_odometer_unit
        date current_odometer_at
        enum status "ACTIVE|STORED|SOLD|SCRAPPED|ARCHIVED"
        uuid primary_image_id FK
        jsonb external_refs
        timestamptz deleted_at
    }
    odometer_entries {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        int value
        enum unit "MILES|KILOMETERS"
        date recorded_on
        enum source "MANUAL|SERVICE|FUEL|INSPECTION|IMPORT|API"
        uuid source_record_id
        bool is_correction
        text correction_reason
    }
    vehicle_images {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        uuid document_id FK
        int sort_order
    }
```

---

## 3. Service and maintenance

```mermaid
erDiagram
    vehicles ||--o{ service_records : "has"
    service_records ||--o{ service_parts : "consumes"
    service_categories ||--o{ service_records : "classifies"
    service_categories ||--o{ maintenance_rules : "templates"
    vehicles ||--o{ maintenance_rules : "follows"
    service_records ||--o| maintenance_rules : "advances"
    contacts ||--o{ service_records : "performed_by"
    contacts ||--o{ service_parts : "supplied_by"
    service_records ||--o{ documents : "evidenced_by"

    service_categories {
        uuid id PK
        uuid workspace_id FK "WS, NULL = system"
        text key
        text name
        int default_interval_km
        int default_interval_months
        bool is_system
    }
    service_records {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        date performed_on
        int odometer
        enum odometer_unit
        uuid category_id FK
        uuid contact_id FK
        text mechanic_name
        numeric parts_total
        numeric labour_total
        numeric tax_total
        numeric total_amount
        char currency
        int warranty_months
        date next_service_on
        int next_service_odometer
        timestamptz deleted_at
    }
    service_parts {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid service_record_id FK
        text name
        text brand
        text manufacturer
        text part_number
        numeric quantity
        numeric unit_price
        char currency
        int warranty_months
        uuid supplier_contact_id FK
    }
    maintenance_rules {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        uuid category_id FK
        text name
        int interval_distance
        enum interval_distance_unit
        int interval_months
        int threshold_distance
        int threshold_days
        date last_completed_on
        int last_completed_odometer
        date next_due_on "server-computed"
        int next_due_odometer "server-computed"
        enum status "OK|DUE_SOON|DUE|OVERDUE"
        bool is_user_overridden
    }
```

---

## 4. Ownership modules

`vehicle_inspections`, `inspection_advisories`, `insurance_policies`, `road_tax_records`,
`expense_categories` and `expenses` are built. `warranties`, `tyre_sets`,
`tyre_installations` and `fuel_entries` are not yet.

`expenses` is the single cost surface: a service, policy or tax record projects itself
into it through `source_type` / `source_record_id`, which are **unique together** so the
same record cannot be counted twice (DATABASE.md §4.8, DECISIONS.md D-058).

`road_tax_records.tax_type` is free text rather than an enum: tax regimes differ by
country (UK Vehicle Excise Duty bands have no equivalent elsewhere), and enumerating them
would make the table exactly as UK-shaped as `country_code` exists to prevent.

```mermaid
erDiagram
    vehicles ||--o{ vehicle_inspections : "passes"
    vehicle_inspections ||--o{ inspection_advisories : "notes"
    vehicles ||--o{ insurance_policies : "insured_by"
    vehicles ||--o{ road_tax_records : "taxed_by"
    vehicles ||--o{ warranties : "covered_by"
    vehicles ||--o{ tyre_sets : "fitted_with"
    tyre_sets ||--o{ tyre_installations : "mounted_as"
    vehicles ||--o{ fuel_entries : "fuelled_by"
    vehicles ||--o{ expenses : "costs"
    expense_categories ||--o{ expenses : "classifies"
    contacts ||--o{ insurance_policies : "provided_by"

    vehicle_inspections {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        enum inspection_type "MOT|ITP|TUV|CT|..."
        date performed_on
        date expires_on
        enum result "PASS|PASS_WITH_ADVISORIES|FAIL|UNKNOWN"
        int odometer
        text certificate_number
    }
    inspection_advisories {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid inspection_id FK
        enum severity
        text text
        bool is_resolved
        uuid resolved_service_record_id FK
    }
    insurance_policies {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        text provider_name
        text policy_number
        date starts_on
        date expires_on
        numeric premium_amount
        char currency
        enum renewal_type
    }
    road_tax_records {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        char country_code
        text tax_type
        date starts_on
        date expires_on
        numeric amount
        char currency
    }
    warranties {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        enum warranty_type "MANUFACTURER|DEALER|THIRD_PARTY|PART|REPAIR"
        date starts_on
        date expires_on
        int distance_limit
        uuid service_record_id FK
        uuid service_part_id FK
    }
    tyre_sets {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        text manufacturer
        text size
        enum season "SUMMER|WINTER|ALL_SEASON"
        date purchased_on
        numeric purchase_price
    }
    tyre_installations {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid tyre_set_id FK
        enum position "FRONT_LEFT|FRONT_RIGHT|REAR_LEFT|REAR_RIGHT|SPARE"
        date installed_on
        int installed_odometer
        date removed_on
        numeric tread_depth_mm
    }
    fuel_entries {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        date filled_on
        int odometer
        numeric quantity
        enum quantity_unit "LITRES|US_GALLONS|IMP_GALLONS|KWH"
        numeric total_amount
        char currency
        bool is_full_tank
    }
    expenses {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        uuid category_id FK
        date incurred_on
        numeric amount
        char currency
        text vendor_name
        enum source_type "projection source"
        uuid source_record_id
    }
```

---

## 5. Documents, contacts, reminders, notifications

`documents` is built (DOC-101…107). `contacts` is not yet.

Files are never stored in PostgreSQL: the row holds a `storage_key` into private object
storage, and all access is a short-lived signed URL issued after a permission check
(SECURITY.md §10, DECISIONS.md D-059/D-060).

```mermaid
erDiagram
    workspaces ||--o{ documents : "stores"
    workspaces ||--o{ contacts : "knows"
    workspaces ||--o{ reminders : "schedules"
    reminders ||--o{ notification_deliveries : "delivers"
    notifications ||--o{ notification_deliveries : "fans_out"
    users ||--o{ notifications : "receives"
    notification_deliveries ||--o| email_messages : "sends"
    email_messages ||--o{ email_delivery_events : "tracked_by"

    documents {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        text storage_key UK "tenant-namespaced, unguessable"
        text original_filename
        text content_type
        bigint byte_size
        text checksum_sha256
        enum document_type
        date document_date
        date expires_on
        enum attached_to_type
        uuid attached_to_id
        enum status "PENDING|AVAILABLE|QUARANTINED|DELETED"
        timestamptz deleted_at
    }
    contacts {
        uuid id PK
        uuid workspace_id FK "WS"
        enum contact_type "WORKSHOP|MECHANIC|TYRE_SHOP|PARTS_SUPPLIER|DEALER|INSURER|RECOVERY"
        text name
        text phone
        citext email
        text website
        text address
    }
    reminders {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid vehicle_id FK
        enum source_type "MAINTENANCE|INSPECTION|INSURANCE|TAX|WARRANTY|DOCUMENT|SERVICE|TYRE|CUSTOM"
        uuid source_id
        uuid target_user_id FK "NULL = all eligible members"
        date due_on
        int due_odometer
        int_array lead_days "default 30,14,7,1"
        enum_array channels
        enum status "SCHEDULED|DUE|SENT|DISMISSED|SNOOZED|COMPLETED|CANCELLED"
        date snoozed_until
    }
    notifications {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid user_id FK
        enum category
        text title
        text body
        text action_url
        uuid vehicle_id FK
        timestamptz read_at
    }
    notification_preferences {
        uuid id PK
        uuid user_id FK
        uuid workspace_id FK "WS"
        enum category
        enum channel "IN_APP|EMAIL|PUSH|SMS|WHATSAPP"
        bool is_enabled
    }
    notification_deliveries {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid reminder_id FK
        uuid user_id FK
        enum channel
        text idempotency_key UK "sha256 of ws, reminder, channel, user, window"
        enum status
        uuid email_message_id FK
        int attempts
    }
    email_messages {
        uuid id PK
        uuid workspace_id FK "WS, nullable"
        uuid user_id FK
        text template
        citext recipient_email
        text subject
        text provider
        text provider_message_id
        enum status "QUEUED|SENDING|SENT|DELIVERED|BOUNCED|COMPLAINED|FAILED|SUPPRESSED"
        text correlation_id
        text idempotency_key UK
        timestamptz sent_at
        timestamptz delivered_at
    }
    email_delivery_events {
        uuid id PK
        uuid email_message_id FK
        text provider_event_id UK "replay-safe"
        text event_type
        timestamptz occurred_at
        jsonb payload
    }
```

---

## 6. Commercial and platform

```mermaid
erDiagram
    plans ||--o{ plan_features : "grants"
    plans ||--o{ subscriptions : "sold_as"
    workspaces ||--|| subscriptions : "subscribes"
    workspaces ||--o{ usage_counters : "consumes"
    workspaces ||--o{ feature_overrides : "adjusted_by"
    admin_users ||--o{ support_access_grants : "requests"
    workspaces ||--o{ support_access_grants : "granted_on"
    admin_users ||--o{ audit_logs : "acts"
    users ||--o{ audit_logs : "acts"

    plans {
        uuid id PK
        text key UK "FREE|PRO|FAMILY|BUSINESS"
        text name
        bool is_public
    }
    plan_features {
        uuid id PK
        uuid plan_id FK
        text key "max_vehicles|max_members|storage_bytes|..."
        int value_int
        bool value_bool
        text value_text
    }
    subscriptions {
        uuid id PK
        uuid workspace_id FK "WS"
        uuid plan_id FK
        enum status "TRIALING|ACTIVE|PAST_DUE|CANCELLED|EXPIRED"
        text provider "nullable until billing exists"
        text provider_subscription_id
        timestamptz current_period_end
    }
    usage_counters {
        uuid id PK
        uuid workspace_id FK "WS"
        text key
        bigint value
        date period_start
        date period_end
    }
    feature_overrides {
        uuid id PK
        uuid workspace_id FK "WS"
        text key
        int value_int
        bool value_bool
        timestamptz expires_at
        text reason
    }
    admin_users {
        uuid id PK
        citext email UK
        text password_hash
        enum role "SUPER_ADMIN|OPERATIONS|SUPPORT|BILLING|READ_ONLY"
        enum status
        text mfa_secret_hash
    }
    support_access_grants {
        uuid id PK
        uuid admin_user_id FK
        uuid workspace_id FK "WS"
        text reason "required"
        text scope
        timestamptz expires_at
        timestamptz revoked_at
    }
    audit_logs {
        uuid id PK
        uuid workspace_id FK "WS, nullable"
        enum actor_type "USER|ADMIN|SYSTEM"
        uuid actor_user_id FK
        uuid actor_admin_id FK
        text action
        text resource_type
        uuid resource_id
        text ip_hash
        text correlation_id
        jsonb metadata "never secrets"
    }
    feature_flags {
        uuid id PK
        text key UK
        bool is_enabled
        int rollout_percentage
        uuid_array allowed_workspace_ids
    }
```

---

## 7. Cardinality notes

- `users ↔ workspaces` is **many-to-many** through `workspace_members`. A user can belong
  to several workspaces and switch between them; a workspace has many members.
- `workspaces → subscriptions` is one-to-one in practice (one active subscription), but is
  modelled as a table rather than columns so subscription history survives plan changes.
- `vehicles → odometer_entries` is one-to-many and **append-only**;
  `vehicles.current_odometer` is a derived cache, never authoritative.
- `service_records → maintenance_rules` is a soft, many-to-optional-one link: a service
  advances at most one rule, and a rule remembers the service that last advanced it.
- `documents.attached_to_type/attached_to_id` is a deliberate polymorphic association.
  It is not a foreign key; integrity is enforced in the application and by the shared
  `workspace_id`, because a document may attach to any of nine parent types and nine
  nullable FK columns would be worse.
