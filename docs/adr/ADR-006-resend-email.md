# ADR-006 — Resend behind an EmailService abstraction

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

Email is not a peripheral feature here — it is a primary delivery channel for the
product's core value. A reminder that does not arrive is a missed MOT.

Two distinct classes of mail must be sent: transactional/security messages that must
always arrive (verification, password reset, security alerts), and notification messages
that users may opt out of (reminders, digests).

Deliverability and observability matter more than the specific provider. Support must be
able to answer "was it sent, and what happened to it?" without logging into a vendor
dashboard.

## Decision

**Resend** as the delivery provider, accessed **only** through an `EmailService`
abstraction in `packages/email`, with a `MailTransport` interface and three
implementations:

| Transport | Environment |
| --- | --- |
| `ResendTransport` | production, staging |
| `SmtpTransport` → Mailpit | local development |
| `MemoryTransport` | tests |

Nothing outside `packages/email/src/transports/resend.transport.ts` may import the Resend
SDK — enforced by an ESLint `no-restricted-imports` rule. Templates are React Email
components producing HTML and a hand-written plain-text alternative. Every send writes an
`email_messages` row **before** the provider call, and a signature-verified webhook
maintains delivery state in `email_delivery_events`.

## Alternatives considered

**Raw SMTP via Nodemailer to a self-managed server.** Full control and no per-message cost.
Rejected: running a mail server well is a specialist job, IP reputation takes months to
build, and a deliverability problem here means users miss safety-relevant reminders.

**SendGrid / Mailgun / Postmark.** All capable. Postmark in particular has an excellent
transactional reputation. Resend was chosen for its React Email integration (templates as
typed components, testable and previewable like any other component), a clean API, and
straightforward webhook signing. The decision is deliberately low-stakes: the transport
interface means switching providers is one new file, not a refactor.

**AWS SES.** Cheapest at volume and highly reliable, but a worse developer experience,
more configuration, and a vendor coupling that `INIT.md` §10 avoids. Worth revisiting if
volume ever makes cost material.

**Calling the provider SDK directly from services.** Rejected outright. It makes testing
require network mocks, makes provider migration a repository-wide refactor, and makes it
possible for a test run to email a real person.

## Consequences

**Positive.** Provider-independent by construction. Tests cannot send real email —
`ResendTransport` throws when `NODE_ENV=test`. Local development needs no API key and
delivers everything to Mailpit. Templates are ordinary React components with previews and
snapshot tests. Delivery history lives in our database, queryable by the admin app.

**Negative.** An abstraction layer to maintain, and provider-specific features are only
available if the interface exposes them. Webhook state must be reconciled — a message with
no terminal event after 24 hours is flagged rather than assumed delivered. Two systems
hold delivery truth; ours is authoritative for support purposes.

**Follow-ons.** SPF, DKIM and DMARC on a dedicated `notifications.` subdomain, kept
separate from any future marketing subdomain so a marketing complaint cannot damage
password-reset deliverability. Open tracking stays off by default.
