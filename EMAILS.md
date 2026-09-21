# EMAILS.md — Email & Notification Delivery

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20
**Provider:** Resend 6.x · **Package:** `packages/email`

---

## 1. Pipeline

```text
API request  ─┐
Scheduler    ─┼─► NotificationService.dispatch()
Domain event ─┘            │
                           ├──► IN_APP: notifications row (synchronous)
                           │
                           └──► EMAIL: notification_deliveries row (idempotency key)
                                        │
                                        ▼
                                BullMQ `emails` queue
                                        │
                                        ▼
                                 Worker consumer
                                        │
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                 preference check   render template   email_messages row
                 (skip if opted     (HTML + text)     created as QUEUED
                  out, non-critical)                  BEFORE the send
                                        │
                                        ▼
                                  MailTransport
                             ┌──────────┴──────────┐
                       ResendTransport      SmtpTransport / MemoryTransport
                        (production)          (local dev)   (tests)
                                        │
                                        ▼
                            provider_message_id stored
                                 status → SENT
                                        │
                        ┌───────────────┘
                        ▼
              POST /api/v1/webhooks/resend  (signature-verified)
                        │
                        ▼
              email_delivery_events + email_messages.status advance
```

**The API never calls Resend.** An HTTP request that waits on a third-party email API is
a request that fails when that API is slow. Sending happens in the worker, always.

---

## 2. The abstraction

Controllers, services and jobs use `EmailService`. Nothing outside
`packages/email/src/transports/resend.transport.ts` imports the Resend SDK — enforced by
an ESLint `no-restricted-imports` rule.

```ts
// packages/email/src/types.ts  (design sketch)
export interface SendEmailInput<T extends TemplateKey> {
  template: T
  to: string
  props: TemplateProps[T]          // typed per template
  locale?: Locale
  workspaceId?: string
  userId?: string
  idempotencyKey: string           // required — no unkeyed sends
  correlationId?: string
  category: NotificationCategory   // drives preference and suppression checks
  metadata?: Record<string, string | number | boolean>
}

export interface MailTransport {
  readonly name: string
  send(message: RenderedEmail): Promise<TransportResult>   // { providerMessageId }
}

export interface EmailService {
  send<T extends TemplateKey>(input: SendEmailInput<T>): Promise<EmailMessageRef>
  render<T extends TemplateKey>(t: T, props: TemplateProps[T], locale?: Locale)
    : Promise<RenderedEmail>       // { subject, html, text }
}
```

Transports:

| Transport | Environment | Behaviour |
| --- | --- | --- |
| `ResendTransport` | production, staging | Real send via Resend API |
| `SmtpTransport` | local development | Sends to Mailpit at `localhost:1025`, viewable at `:8025` |
| `MemoryTransport` | tests | Captures messages in an array; asserts without network |

Transport selection comes from `MAIL_TRANSPORT` in `packages/config`. **Tests can never
reach the real provider**: `MemoryTransport` is the default when `NODE_ENV=test`, and
`ResendTransport` throws at construction if `NODE_ENV === 'test'`.

---

## 3. Templates

React Email components in `packages/email/src/templates/`. Each exports the component,
its typed props, a subject builder and a plain-text renderer.

| Template | Category | Critical? | Trigger |
| --- | --- | --- | --- |
| `verify-email` | ACCOUNT | ✅ | Registration, email change |
| `password-reset` | ACCOUNT | ✅ | Reset requested |
| `password-changed` | SECURITY | ✅ | Password changed |
| `security-alert` | SECURITY | ✅ | New device, lockout, suspicious login |
| `welcome` | ACCOUNT | ✅ | Email verified |
| `workspace-invitation` | ACCOUNT | ✅ | Member invited |
| `ownership-transferred` | SECURITY | ✅ | Workspace ownership changed |
| `service-due` | MAINTENANCE | — | Maintenance rule enters DUE_SOON/DUE ✅ |
| `service-overdue` | MAINTENANCE | — | Maintenance rule OVERDUE ✅ |
| `inspection-expiry` | INSPECTION | — | MOT/inspection expiring |
| `insurance-expiry` | INSURANCE | — | Policy expiring |
| `tax-expiry` | TAX | — | Road tax expiring |
| `warranty-expiry` | WARRANTY | — | Warranty expiring |
| `document-expiry` | DOCUMENT | — | Stored document expiring |
| `odometer-stale` | MAINTENANCE | — | No reading for 45 days ✅ |
| `weekly-digest` | DIGEST | — | Monday, user's local morning |
| `monthly-summary` | DIGEST | — | 1st of month, user's local morning |
| `plan-limit-reached` | ACCOUNT | — | Entitlement blocked an action |
| `export-ready` | ACCOUNT | — | Async export completed |

**Critical** templates ignore notification preferences and unsubscribe state. They are
transactional and security messages; a user who has muted everything still gets their
password reset. Everything else respects preferences and carries a preferences link.

### 3.1 Template requirements

Every template must have:

- an HTML body **and** a hand-written plain-text alternative (not a naive HTML strip),
- a single, obvious primary CTA with a full absolute URL,
- the vehicle and workspace context in the subject where relevant —
  `Ford Mondeo: oil service due in 620 miles` beats `Maintenance reminder`,
- a footer with the workspace name, a preferences link, and an unsubscribe link for
  non-critical categories,
- a preheader line,
- a layout that survives Outlook: tables, inline styles, 600 px max width, no flexbox,
  no grid, no web fonts, no background images carrying meaning,
- images with `alt` text and no reliance on images being loaded,
- text no smaller than 14 px, and contrast meeting WCAG AA.

### 3.2 Shared layout

`BaseLayout` provides header with logo, content slot, footer with legal address and
preference links, and light/dark-tolerant colours (dark mode in email is unreliable;
templates use colours that work in both rather than `prefers-color-scheme` tricks).

---

## 4. Idempotency and deduplication

**The rule:** the same reminder, for the same user, in the same notification window,
sends exactly once — no matter how many times a worker retries.

```ts
idempotencyKey = sha256([
  workspaceId, reminderId, channel, recipientUserId, windowKey
].join('|'))
```

`windowKey` names the notification window:

| Situation | `windowKey` |
| --- | --- |
| 30-day lead | `due-30d` |
| 7-day lead | `due-7d` |
| Day of | `due-0d` |
| Overdue, weekly nag | `overdue-2026-W38` |
| Weekly digest | `digest-weekly-2026-W38` |
| Monthly summary | `digest-monthly-2026-09` |

`notification_deliveries.idempotency_key` and `email_messages.idempotency_key` both carry
unique constraints. The worker inserts the delivery row **before** sending; a unique
violation means "already handled" and the job completes successfully without sending.

This makes the whole pipeline safe under: BullMQ retries, worker crashes mid-send,
duplicate scheduler runs, and a scheduler re-run after a failed deploy.

**Account-level tokens** (verification, reset) are not deduplicated this way — a user may
legitimately request several. They are rate-limited instead (`SECURITY.md` §8), and each
issued token invalidates the previous one.

---

## 5. Delivery tracking

`email_messages` rows are created **before** the provider call. Support must be able to
answer "was it sent?" even when the provider call itself failed.

**Status machine — monotonic, never regresses:**

```text
QUEUED ──► SENDING ──► SENT ──► DELIVERED
                        │          │
                        │          ├──► COMPLAINED   (spam report)
                        │          └──► (terminal)
                        ├──► DELAYED ──► DELIVERED | BOUNCED
                        ├──► BOUNCED    (terminal)
                        └──► FAILED     (terminal — provider rejected)

SUPPRESSED  ← set before sending when the address is on the suppression list
```

A late-arriving `sent` webhook never overwrites `delivered`. Transitions are applied by a
rank comparison, not by blind assignment.

`email_delivery_events` keeps the full append-only history: `sent`, `delivered`,
`delivery_delayed`, `bounced`, `complained`, `opened`, `clicked`, `suppressed`. The
`provider_event_id` unique constraint makes webhook replay a no-op.

**We do not rely on the Resend dashboard as historical storage.** Provider retention is
limited and the dashboard is not queryable from the admin app. Application-side history is
the record.

### 5.1 Open and click tracking

Open tracking is **off by default** — pixel tracking on maintenance reminders is not worth
the privacy cost, and Apple Mail Privacy Protection makes the data meaningless anyway.
Click tracking is enabled only on digest emails, where link engagement genuinely informs
whether the digest is worth sending.

---

## 6. Webhook ingestion

```text
POST /api/v1/webhooks/resend
```

1. Read the **raw** body (route registered before JSON parsing).
2. Verify the Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) against
   `RESEND_WEBHOOK_SECRET` using a constant-time comparison.
3. Reject timestamps older than 5 minutes.
4. Return `202` immediately and enqueue processing — a slow handler causes provider
   retries and duplicate work.
5. The consumer inserts `email_delivery_events` (unique on `provider_event_id`), advances
   `email_messages.status` by rank, and on `bounced`/`complained` adds the address to the
   suppression list and disables non-critical email for that user.

Unverifiable signature → `401`, logged as a `system_event` with severity `WARN`. Unknown
`provider_message_id` → stored as an orphan event rather than discarded; it usually means
a race between the send transaction and a fast webhook.

---

## 7. Suppression and bounces

The list lives in `email_suppressions` and is **not** workspace-scoped: a mailbox that no
longer exists does not exist for any tenant, and a spam complaint follows the address. It
therefore has no `workspace_id` and is deliberately absent from the tenant client's model
set.

**What gets an address on the list**

- A bounce the provider classifies as **permanent** → `HARD_BOUNCE`.
- A spam complaint → `COMPLAINT`.
- An operator adding one by hand → `MANUAL`.

Transient and *unclassified* bounces do **not** suppress. A full mailbox or a greylisting
blip clears by itself, and wrongly suppressing an address silently ends that owner's MOT,
insurance and service reminders — a worse failure than one wasted send. This is the
conservative half of an earlier rule ("three soft bounces in 30 days count as hard"), which
is not built: counting soft bounces over a window needs history this table does not keep
yet.

**What the list blocks** (`suppressionBlocks`, one pure function, unit-tested)

| Reason | Blocks | Rationale |
| --- | --- | --- |
| `HARD_BOUNCE` | everything, including `ACCOUNT` and `SECURITY` | the mailbox does not exist, so no send can succeed |
| `MANUAL` | everything | an operator decided so explicitly |
| `COMPLAINT` | everything **except** `ACCOUNT` and `SECURITY` | someone who marked a reminder as spam must still be able to reset their own password |

The `COMPLAINT` row resolves a contradiction in the original draft of this section, which
said a complaint disabled non-critical mail and, one bullet later, that critical mail to a
suppressed address was blocked as well. Locking a user out of their own account recovery
because they once objected to a reminder is the worse of the two failures.

A blocked message is **recorded** as `SUPPRESSED` before the provider is called, never
silently dropped, so support can answer "why did this user never get their email?".

**Getting off the list.** Releasing sets `released_at` rather than deleting the row: why an
address was once refused is exactly what someone needs when it bounces again. A later
bounce on a released address re-suppresses it — one manual release must not permanently
disarm the protection. Both actions are in the admin console under **Suppressions**.

**Not built yet.** Flagging the user's address as undeliverable in the dashboard, with a
banner asking them to update it (needs `UI`/`NOT` work), and soft-bounce counting.

---

## 8. Preferences

Per user, per workspace, per category, per channel.

| Category | Email | In-app | Disableable |
| --- | :-: | :-: | :-: |
| ACCOUNT | ✓ | ✓ | ✗ |
| SECURITY | ✓ | ✓ | ✗ |
| MAINTENANCE | ✓ | ✓ | ✓ |
| INSPECTION | ✓ | ✓ | ✓ |
| INSURANCE | ✓ | ✓ | ✓ |
| TAX | ✓ | ✓ | ✓ |
| WARRANTY | ✓ | ✓ | ✓ |
| DOCUMENT | ✓ | ✓ | ✓ |
| DIGEST | ✓ | — | ✓ (off by default) |
| PRODUCT_UPDATES | ✓ | ✓ | ✓ (opt-in only) |

Defaults on registration: all reminder categories on for email and in-app; digests off;
product updates off. Marketing consent is a separate, explicit checkbox, never bundled
with terms acceptance.

The unsubscribe link carries a signed, user-scoped token, works without signing in
(one-click, as required by bulk-sender rules), and lands on a page that unsubscribes the
specific category while offering "all optional email" as a second click.

---

## 9. Scheduling and timezones

Reminder emails are sent at **09:00 in the recipient's local timezone**
(`user_profiles.timezone`, defaulting to the workspace timezone, defaulting to UTC).

The hourly scheduler selects the timezone buckets whose local time is currently 09:00 and
processes only those users. This avoids both a nightly thundering herd and emails arriving
at 3 a.m.

Digests: weekly on Monday 07:00 local; monthly on the 1st at 07:00 local.

**Quiet hours:** no non-critical email between 21:00 and 07:00 local. A reminder that
becomes due at 23:00 waits for the next morning.

---

## 10. Sender configuration

```text
From:      AutoServices <notifications@example.com>
Reply-To:  support@example.com
```

Separate subdomains isolate reputation: `notifications.example.com` for transactional and
reminder mail, `mail.example.com` for any future marketing. A marketing complaint must not
be able to damage password-reset deliverability.

Required DNS: SPF, DKIM (Resend-provided keys), and DMARC starting at `p=none` with
reporting, moving to `p=quarantine` then `p=reject` once the reports are clean.

---

## 11. Local development

`docker compose up` starts Mailpit. `MAIL_TRANSPORT=smtp` sends every email there;
open `http://localhost:8025` to read it, including the plain-text alternative and the raw
source. No Resend key is needed for local development, and no local run can email a real
person.

A template preview server (`pnpm --filter @autoservices/email preview`) renders every
template with sample props at `http://localhost:3300`, so templates can be iterated on
without triggering the events that produce them.

---

## 12. Testing

Covered in `TESTING.md` §5. Specifically required:

- **Render tests** — every template renders with representative props; HTML and text both
  non-empty; the CTA URL is absolute; no unresolved `{{placeholder}}` survives; snapshots
  guard against accidental layout changes.
- **Dispatch tests** — preference checks honoured; critical templates bypass preferences;
  suppressed addresses handled.
- **Idempotency tests** — the same key twice produces one message; concurrent duplicate
  jobs produce one message.
- **Retry tests** — a transport failure retries with backoff and does not duplicate.
- **Webhook tests** — valid signature accepted; invalid rejected; replayed event is a
  no-op; status never regresses.
- **No test may construct `ResendTransport`.** A CI check greps the test tree for it.


---

## 13. Implementation status (as built)

| Piece | State |
| --- | --- |
| `EmailService` + transports (Resend / SMTP / memory) | ✅ |
| Templates: verify, reset, password-changed, welcome, invitation, service-due, service-overdue, odometer-stale | ✅ |
| Queue producer, worker consumer, Mailpit delivery | ✅ |
| Idempotent delivery via `notification_deliveries.idempotency_key` | ✅ |
| `email_messages` / `email_delivery_events` tables | ✅ written on every send, with monotonic status ranking |
| Resend webhook ingestion | ✅ signature-verified, replay-safe |
| Suppression list and bounce handling | ✅ permanent bounces and complaints; soft-bounce counting ❌ |
| Admin inspection of delivery and suppressions | ✅ operations console |
| "Address undeliverable" banner in the dashboard | ❌ |
| Timezone-bucketed send hours and quiet hours | ❌ scan is hourly; local send windows not applied |

**Known gaps.** Send windows are not timezone-aware, so a reminder can arrive at an
antisocial local hour. Soft bounces are recorded as events but never escalate to a
suppression. And a user whose address hard-bounces is not yet told so in the dashboard —
the platform stops mailing them, but nothing prompts them to fix the address.
