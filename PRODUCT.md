# PRODUCT.md — Product Definition

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20

---

## 1. Problem

Vehicle history is fragmented and perishable. Receipts fade in glove boxes, service
books get lost, the garage that did the timing belt closes down, and the only person who
knows when the insurance renews is the person who happened to buy it.

The costs are concrete:

- **Missed maintenance** → premature failure of expensive components.
- **Lapsed obligations** → fines, invalid insurance, undriveable vehicle.
- **Unprovable history** → measurably lower resale value.
- **Invisible cost of ownership** → no idea what a vehicle actually costs per year.

For families and small businesses this multiplies by the number of vehicles and divides
by the number of people who know anything about them.

## 2. Solution

A workspace-based record of every vehicle: what was done, when, at what mileage, by whom,
for how much, with the paperwork attached — and a reminder engine that tells the right
people what is due before it becomes a problem.

---

## 3. Personas

### 3.1 Andrei — the enthusiast owner (primary, MVP)
Owns two cars and a motorcycle. Does some work himself, uses an independent garage for
the rest. Keeps receipts but cannot find them. Wants a provable history at resale time,
and to stop discovering the MOT expired yesterday.

**Needs:** fast service entry, parts detail, mileage-based reminders, document storage.
**Success:** adds a vehicle and its last service in under three minutes.

### 3.2 The Popescu family — shared garage (MVP tenancy, post-MVP invitations)
Two adults, three vehicles, one person currently doing all the admin. Both want to see
what is due; either might take a car to the garage.

**Needs:** shared workspace, both members notified, whoever paid can log the expense.
**Success:** the second member is not a second account with duplicated data.

### 3.3 Maria — small business / fleet manager (post-MVP focus)
Runs a company with six vans and four drivers. Needs inspection and insurance compliance,
per-vehicle cost reporting, and drivers who can log fuel and mileage without seeing
company financials.

**Needs:** roles, per-vehicle cost reports, driver-limited access, exports for accounting.
**Success:** no vehicle ever fails to renew, and cost-per-mile is visible per van.

### 3.4 Internal operator (admin app)
Support and operations staff. Needs to diagnose "I didn't get my reminder email",
inspect queue health, and check an account's state — **without** casually browsing
customer documents, and with every access audited.

---

## 4. Core user journeys

### 4.1 Registration → first value
```text
Register → verify email → Personal Garage created automatically
        → add first vehicle (make, model, year, registration)
        → enter current odometer
        → optionally add known expiry dates (MOT, insurance, tax, warranty)
        → choose notification preferences
        → dashboard with real, populated content
```
Every step after vehicle creation is skippable. The dashboard must be useful with one
vehicle and nothing else, and must never show an empty shell.

**Target:** under 4 minutes from landing on the marketing site to a populated dashboard.

### 4.2 Logging a service
```text
Vehicle → Service History → Add Service
  date · odometer · category · workshop · parts · labour · total · currency
  attach invoice · set next service date / mileage
→ maintenance rules for matching categories update automatically
→ odometer entry created from the service reading
→ timeline entry appears
```
The user enters the service once. The system updates maintenance state, odometer history
and the timeline as consequences — never as separate chores.

### 4.3 Being reminded
```text
Nightly scheduler evaluates due-state across all workspaces
  → reminder transitions SCHEDULED → DUE
  → in-app notification created
  → email job enqueued (deduplicated by idempotency key)
  → worker renders template, sends via Resend, records email_message
  → Resend webhook updates delivery state
User: snooze · dismiss · complete · adjust threshold
```

### 4.4 Proving history at sale
```text
Vehicle → Export → complete history (PDF/CSV/JSON)
  all services, parts, inspections, mileage log, documents index
```
Post-MVP, but the data model must support it from the first migration.

---

## 5. Feature requirements

Priority: **P0** = MVP · **P1** = shortly after MVP · **P2** = later.

### 5.1 Identity & account — P0
Registration with email verification; login/logout; Argon2id passwords; password reset
with hashed, single-use, expiring tokens; session list with individual and bulk
revocation; account settings (name, timezone, locale, units, currency); account
deletion request flow. **P1:** TOTP 2FA. **P2:** Google/Apple SSO, passkeys.

### 5.2 Workspaces & members — P0 (invitations P1)
Automatic Personal Garage on registration; workspace settings (name, type, default
currency, default distance unit, timezone); membership with roles; workspace switcher.
**P1:** email invitations, role management UI, member removal with ownership transfer.
**P2:** per-vehicle granular access.

### 5.3 Vehicles — P0
Full attribute set (see `INIT.md` §3 and `DATABASE.md` §4); status lifecycle
ACTIVE / STORED / SOLD / SCRAPPED / ARCHIVED; images with a primary image; notes;
soft delete. Selling or archiving a vehicle **never** destroys its history.

### 5.4 Odometer — P0
Append-only `odometer_entries` with value, unit, date, source and notes. Sources:
MANUAL, SERVICE, FUEL, INSPECTION, IMPORT, API. Current mileage is derived from the
latest valid entry and cached on the vehicle. Regressions are blocked by default,
correctable with an explicit override that is audited. Staleness (>45 days) prompts the
user to update, because mileage-based reminders silently rot without it.

### 5.5 Service history — P0
Service records with date, odometer, category, workshop/contact, mechanic, parts, labour,
tax, total, currency, notes, attachments, warranty, next-service date/mileage.
System service categories plus per-workspace custom categories. Structured parts with
brand, manufacturer, part number, quantity, unit price, warranty, supplier.

### 5.6 Maintenance engine — P0
Rules that are time-based, distance-based or combined (whichever comes first). Per-vehicle
rules seeded from a category template, fully user-overridable. Server-computed status:
OK / DUE_SOON / DUE / OVERDUE. Completing a matching service advances the rule.
Never computed in the frontend.

### 5.7 Ownership modules
| Module | Priority |
| --- | --- |
| Inspection / MOT (with advisories) | P0 |
| Insurance | P0 |
| Road tax / registration | P0 |
| Expenses | P0 |
| Warranty | P1 |
| Fuel + consumption analytics | P1 |
| Tyres and tyre sets | P1 |

### 5.8 Documents — P0
Private S3-backed vault. Signed upload, signed short-lived download, MIME and extension
allow-list, size cap, per-workspace storage accounting. Attachable to vehicle, service,
inspection, insurance, tax, warranty or expense. Never public.

### 5.9 Reminders & notifications — P0
Generic reminder engine over every expiry-bearing source; date-based and mileage-based
thresholds; configurable lead windows (default 30/14/7/1 days); statuses SCHEDULED, DUE,
SENT, DISMISSED, SNOOZED, COMPLETED, CANCELLED; in-app notification centre with read
state; email via Resend with per-category preferences; delivery tracking via webhook.

### 5.10 Reporting — P1
Per vehicle: spend by category, monthly and annual cost, cost per mile/km, fuel economy.
Per workspace: total cost, cost by vehicle, cost by category, maintenance due/overdue.
Date-range filtered. **P2:** CSV/PDF/JSON export.

### 5.11 Administration — P0 (subset)
P0: admin auth, platform metrics, user and workspace lookup, email delivery inspection,
queue and failed-job visibility, audit log viewer.
P1: plan/subscription management, feature flag management, audited support access.

### 5.12 Commercial — P1
Plans, plan features, subscriptions, usage counters, feature overrides, centralised
`EntitlementService`. Real billing is P2 behind a provider-agnostic interface.

---

## 6. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Isolation | Zero cross-workspace data access. Enforced in data layer, proven by tests. |
| Performance | p95 API read < 300 ms; dashboard first contentful paint < 1.5 s on broadband. |
| Availability | Nightly scheduler must survive worker restarts; jobs are idempotent. |
| Accessibility | WCAG 2.2 AA for the dashboard's core flows. |
| Responsiveness | Fully usable at 360 px width; PWA-ready. |
| Internationalisation | No user-facing string hardcoded deep in components. English first. |
| Data durability | Nightly Postgres backups, versioned object storage, tested restores. |
| Privacy | Data export and account deletion workflows; documented retention. |

---

## 7. Success metrics

**Activation:** % of registrations that add a vehicle (target > 70%); % that add a
service or expiry date within 7 days (target > 40%).
**Retention:** % of workspaces with any activity in a 90-day window (target > 55%).
**Core value:** % of reminders acted on (completed or snoozed, not ignored) — target > 60%.
**Deliverability:** email delivery rate > 99%, bounce rate < 1%.
**Quality:** zero cross-tenant incidents. This is the only metric with a target of exactly zero.

---

## 8. Product principles

1. **Never lose history.** Deletion is the exception, archival the default.
2. **Ask once.** A service entry updates maintenance, odometer and timeline by itself.
3. **Be specific.** "Oil service due in 620 miles" beats "maintenance due".
4. **Earn the notification.** Every email must be worth the interruption; every optional
   category must be switchable off in one click.
5. **Assume the user is not an expert.** Sensible defaults, plain language, no jargon
   without explanation.
6. **Local terminology matters.** A British user sees "MOT"; the domain model says
   `vehicle_inspection`.
