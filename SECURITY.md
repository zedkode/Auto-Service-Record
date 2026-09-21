# SECURITY.md — Security Model

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20

> This document describes controls that are **designed**. Controls marked *(planned)* are
> not yet implemented. We do not claim any compliance certification. We are not SOC 2,
> ISO 27001 or PCI-DSS certified, and no document in this repository may say otherwise.

---

## 1. Threat model

| # | Threat | Impact | Primary control |
| --- | --- | --- | --- |
| T1 | Cross-tenant data access | **Critical** | Three-layer isolation (§3) |
| T2 | Credential stuffing / brute force | High | Argon2id, rate limits, lockout (§4, §8) |
| T3 | Session hijacking | High | HttpOnly/Secure/SameSite cookies, rotation (§5) |
| T4 | Privilege escalation within a workspace | High | Server-side RBAC on every mutation (§6) |
| T5 | Private document exposure | **Critical** | Private buckets, signed short-lived URLs (§10) |
| T6 | Malicious file upload | High | MIME + extension allow-list, size caps, quarantine (§10) |
| T7 | Insider / support over-access | High | Audited, time-boxed support grants (§13) |
| T8 | Forged provider webhooks | Medium | Signature verification, replay protection (§11) |
| T9 | Injection (SQL, XSS) | High | Prisma parameterisation, React escaping, CSP (§7) |
| T10 | Secret leakage | High | Env-only secrets, redacted logs, scanning (§14) |
| T11 | Enumeration of users or resources | Medium | Uniform responses, 404-over-403, UUIDv7 (§3, §4) |
| T12 | Denial of service via expensive queries | Medium | Pagination caps, query timeouts, rate limits (§8) |

---

## 2. Principles

1. **Deny by default.** Every endpoint requires authentication and an explicit permission
   unless deliberately marked public.
2. **Defence in depth.** No single control is trusted to prevent a critical failure.
3. **Fail closed.** If the workspace context cannot be resolved, the request is refused.
4. **Least privilege.** Both customer roles and internal admin roles grant the minimum.
5. **Everything sensitive is audited.** Especially anything an employee does.
6. **Secrets never touch the repository.** Not once, not in a test, not in a comment.

---

## 3. Tenant isolation (T1)

The highest-severity class of bug this product can ship. Three independent layers:

**Layer 1 — Context resolution.** `WorkspaceGuard` resolves the workspace from the route
and requires an `ACTIVE` `workspace_members` row for the authenticated user. Non-members
receive **404, not 403** — a 403 confirms the resource exists.

**Layer 2 — Scoped data access.** Tenant queries run through a Prisma client extension
that injects `workspaceId` into every `where` and every `data`. The set of tenant-owned
models is derived from the schema (any model with a `workspaceId` field), so a new model
is protected automatically. Bypassing requires the explicitly named, lint-restricted,
audited `$unscoped()` accessor.

**Layer 3 — Database constraints.** Composite foreign keys `(id, workspace_id)` make a
cross-workspace parent/child pair rejectable by Postgres itself.

**Verification.** `pnpm test:isolation` is generated from the Prisma schema and asserts,
for every tenant-owned model, that workspace A's member gets 404 on workspace B's rows
for read, list, update and delete. A new tenant model without a passing isolation test
fails CI. This suite is also mandated as an E2E scenario (`TESTING.md` §6).

---

## 4. Authentication (T2, T11)

**Passwords.** Argon2id with `memoryCost = 19456 KiB (19 MiB)`, `timeCost = 2`,
`parallelism = 1`, 32-byte output, 16-byte random salt — the OWASP minimum configuration.
Parameters live in `packages/auth` and are versioned so hashes can be upgraded on next
successful login. Minimum 12 characters, checked against a breached-password list
*(planned)*. No composition rules — length and breach-checking beat symbol requirements.

**Verification and reset tokens.** 32 bytes from a CSPRNG, delivered in the email,
**stored only as a SHA-256 hash**. Single-use (`consumed_at`), short-lived (verification
24 h, reset 1 h), and invalidated when a new one is issued or the password changes.

**Uniform responses.** Registration with an existing email and password reset for an
unknown address both return the same generic success message. Login failures return one
message regardless of whether the user exists. Timing is equalised by always performing a
hash comparison, against a dummy hash when the user is absent.

**Lockout.** Progressive delay after 5 consecutive failures, temporary lock after 10, with
a security-alert email. Locks are per account **and** per source IP, so one attacker
cannot lock out a whole user base by trying one password against many accounts.

**Verification requirement.** Unverified accounts may sign in but cannot create a second
workspace, invite members, or receive non-transactional email.

**Future:** TOTP 2FA (P1), WebAuthn passkeys and OIDC providers (P2). The session model
already supports multiple authentication methods per user.

---

## 5. Sessions (T3)

- Opaque 32-byte random token; **only its SHA-256 hash is stored**. A database leak does
  not yield usable sessions.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-scoped to the API origin
  with a parent-domain cookie for `app.` and `api.` subdomains.
- Absolute lifetime 30 days; idle timeout 14 days; `last_seen_at` updated at most once per
  5 minutes to avoid a write per request.
- **Rotated on privilege change** — password change, email change, 2FA enrolment.
- **All sessions revoked** on password reset, with the acting session optionally retained.
- Users see their active sessions (device, approximate location from hashed IP, last seen)
  and can revoke one or all.
- Admin sessions are a **separate cookie, separate table, separate lifetime (8 h), on a
  separate origin**. A customer session is never valid for the admin app.

---

## 6. Authorisation (T4)

Two disjoint RBAC systems — workspace roles for customers, admin roles for staff. They
share no table, no token, no guard and no code path. The matrices are in
`ARCHITECTURE.md` §5.

- Every mutating endpoint declares `@RequirePermission(...)`. An endpoint without one
  fails a CI check that enumerates routes and asserts each has an explicit decorator
  (including an explicit `@Public()` where intended).
- Permission evaluation happens server-side against the role stored in the database for
  *this* request — never from a claim in a token the client sent.
- Frontend permission checks exist only to hide affordances. They are cosmetic.
- Role changes take effect immediately; they are read per request, not cached in a token.
- An ADMIN cannot modify or remove the OWNER. Ownership transfer is a single atomic,
  audited operation.

---

## 7. Injection and browser security (T9)

**SQL injection.** Prisma parameterises everything. Raw SQL is permitted only via
`$queryRaw` tagged templates (parameterised); string-concatenated SQL is a lint error.

**XSS.** React escapes by default. `dangerouslySetInnerHTML` is banned by lint rule with
no exceptions in application code. User-supplied content is never rendered as HTML.
Content-Security-Policy on all three frontends:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://<storage-host>;
connect-src 'self' https://api.example.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none'
```

**CSRF.** Cookie sessions use `SameSite=Lax` plus a double-submit CSRF token on all
state-changing requests, and an `Origin`/`Referer` check on the API. The API accepts
`application/json` only for mutations, which blocks classic form-based CSRF.

**Other headers.** `Strict-Transport-Security` (2 years, includeSubDomains, preload),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` denying camera, microphone, geolocation and payment.

**CORS.** Explicit allow-list of the three known frontend origins. `credentials: true`.
No wildcard, ever.

---

## 8. Rate limiting and abuse (T2, T12)

| Endpoint class | Limit |
| --- | --- |
| `POST /auth/login` | 5 / 15 min per IP+email, 20 / h per IP |
| `POST /auth/register` | 3 / h per IP |
| `POST /auth/forgot-password` | 3 / h per email, 10 / h per IP |
| `POST /auth/verify-email/resend` | 3 / h per user |
| Document upload session | 60 / h per workspace |
| Authenticated API (general) | 300 / min per user |
| Webhooks | 1000 / min per source IP |

Redis-backed sliding window, applied before any database work. Responses include
`Retry-After`. Rate-limit rejections are logged as `system_events` for admin visibility.

Query cost is bounded: pagination is capped at 100 items, a statement timeout is set on
the database connection, and report queries run against date-bounded ranges only.

---

## 9. Input validation

Zod schemas in `packages/validation` are the single source of truth, applied by a global
NestJS pipe and reused by frontend forms. Unknown properties are stripped, not ignored.
Every string has a maximum length. Every number has bounds. Every enum is closed. Dates
are validated as `YYYY-MM-DD` for calendar fields and ISO-8601 for instants.

Business-rule validation (odometer regression, date ordering, currency consistency) lives
in services, not schemas, and produces typed domain errors.

---

## 10. File uploads and object storage (T5, T6)

- **Private buckets.** No public read. No public list. No website hosting. Verified by an
  automated check in the deployment runbook.
- **Signed upload.** The client requests an upload session; the API validates the declared
  content type, extension and size against plan limits, creates a `PENDING` document row,
  and returns a presigned PUT valid for 15 minutes.
- **Finalisation.** The API verifies the object exists, matches the declared size, and
  matches the declared SHA-256 checksum before promoting the row to `AVAILABLE`. Objects
  never confirmed are reaped nightly.
- **Signed download.** Issued only after a permission check, valid for 5 minutes,
  single-purpose, with `Content-Disposition: attachment` and the original filename.
- **Allow-list.** `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
  Both the declared MIME type and the file extension must be allowed and must agree;
  magic-byte sniffing on the server confirms it at finalisation. A file whose leading
  bytes disagree with its declared type is quarantined, not served.
- **Size caps.** 20 MB per file. The per-workspace total from plan entitlements is
  *(planned)* — `DOC-105`, which needs the entitlement system.
- **Keys.** `workspaces/{workspaceId}/{yyyy}/{mm}/{uuidv7}{ext}` — tenant-namespaced and
  unguessable. Original filenames are stored as metadata, never used as keys.
- **Malware scanning.** `scan_status` and `QUARANTINED` exist and are enforced; an actual
  scanner is *(planned)*. A verified upload is therefore recorded as `SKIPPED`, never
  `CLEAN` — the platform does not claim an inspection it did not perform
  (DECISIONS.md D-062). Documents are never served while quarantined.
- **SVG is not accepted.** SVG is a script execution vector.

---

## 11. Webhooks (T8)

- `POST /api/v1/webhooks/resend` is unauthenticated by design and **must** verify the
  Svix-style signature (`svix-id`, `svix-timestamp`, `svix-signature`) against
  `RESEND_WEBHOOK_SECRET` using a constant-time comparison before parsing the body.
- Timestamps older than 5 minutes are rejected (replay window).
- `provider_event_id` carries a unique constraint, so a replayed event is an idempotent
  no-op rather than a duplicated state transition.
- The raw body is required for signature verification — the route is registered with a
  raw-body parser, before any JSON transformation.
- Processing is queued; the endpoint returns 2xx quickly so the provider does not retry a
  successfully received event.

---

## 12. Privacy, GDPR and data lifecycle

The platform is designed to support these rights. Implementation is phased.

| Right | Mechanism | Status |
| --- | --- | --- |
| Access / portability | Full data export (JSON + documents) | P2 |
| Rectification | Standard editing; odometer corrections are audited | P0 |
| Erasure | Account deletion workflow below | P1 |
| Restriction | Account suspension | P1 |
| Consent | Separate marketing consent, never bundled with terms | P0 |
| Objection | Per-category notification preferences | P0 |

**Account deletion workflow:**

1. User requests deletion; account enters `DELETION_REQUESTED`, sessions revoked, a
   confirmation email is sent.
2. **Blocking check:** if the user is the OWNER of a workspace with other members, they
   must transfer ownership or delete the workspace first. Deleting an account must never
   orphan or destroy other members' data.
3. 30-day grace period; the user can cancel by signing in.
4. On expiry: personal data erased or anonymised, documents removed from object storage,
   personal workspaces removed.
5. **Retained:** audit log entries (actor ID retained, personal data removed), and
   financial records where law requires. The retained set is minimal, documented, and
   disclosed in the privacy policy.

**Retention defaults:** sessions 30 days after expiry; consumed tokens 7 days;
`email_delivery_events` 13 months; `audit_logs` 24 months; `system_events` 90 days;
soft-deleted rows purged 30 days after deletion.

**Data residency:** primary region EU. No customer data is sent to third parties other
than the email provider (recipient address and message content) and the object-storage
provider (document contents). Both are named in the privacy policy and covered by a DPA.

---

## 13. Administrative access (T7)

- Separate origin, separate credentials, separate session store, 8-hour sessions.
- **Mandatory 2FA for all admin accounts — built and enforced.** Login requires a password
  and a TOTP code in one request, and an account that has not completed enrolment cannot
  sign in at all. TOTP is RFC 6238, implemented in `packages/auth` and asserted against the
  RFC's published test vectors (DECISIONS.md D-063).
- IP allow-listing supported for admin origin *(planned)*.
- **Admins cannot read customer documents or vehicle content by default — built and
  enforced.** No admin role holds a permission that reads either, so a grant is not an
  escalation of an existing right: it *is* the right. A grant requires a written reason of
  at least 20 characters, a scope (`VEHICLE_CONTENT`, `DOCUMENTS` or `FULL`) and an expiry
  capped at 24 hours, and can be revoked at any time.
- **Every use of a grant is audited, not only the granting** (DECISIONS.md D-068), and so
  is every refused attempt. The grant carries a use counter, so "was this access actually
  needed?" is answerable.
- A grant opens document **metadata** only. There is no admin endpoint that returns a
  customer's file, and none is planned until a real case needs one (D-070).
- Every admin action writes an `audit_logs` row with `actor_type = ADMIN`.
- **No silent impersonation.** If impersonation is added later, it must be time-boxed,
  banner-visible to the customer, fully audited, and incapable of changing credentials,
  billing or exporting data.
- Admins can never read passwords. Passwords are not recoverable by anyone, by design.

---

## 14. Secrets and dependencies (T10)

- Secrets come from the environment only, loaded and validated by `packages/config`.
  The application **refuses to start** if a required secret is missing or obviously a
  placeholder.
- `.env` is git-ignored; only `.env.example` is committed, with non-functional placeholders.
- Secret scanning runs in CI on every push, and pre-commit locally *(planned)*.
- Logs are redacted for `password`, `token`, `secret`, `authorization`, `cookie`,
  `set-cookie`, `apiKey`. Request bodies are never logged for auth endpoints.
- Dependencies: `pnpm audit` in CI, automated update PRs, lockfile committed, exact
  versions pinned. A high-severity advisory blocks merge.
- Rotation: session secret, webhook secret and storage credentials are rotatable without
  downtime; the session secret supports two active keys during rotation.

---

## 15. Audit logging

Audited actions include: authentication events (login, failure, logout, lockout),
password and email changes, session revocation, workspace creation/update/deletion,
member invite/join/role change/removal, ownership transfer, vehicle deletion, service
deletion, document upload/download/deletion, odometer corrections, subscription changes,
every admin action, and every support access grant and use.

Each record carries: actor (type + id), action, resource type and id, workspace, UTC
timestamp, hashed IP, user agent, correlation ID, and non-sensitive metadata.

`audit_logs` is append-only. The application has no delete path for it; only the retention
job removes rows, and its deletions are themselves logged as `system_events`.

**Never in audit metadata:** passwords, hashes, tokens, session identifiers, document
contents, full email bodies, payment details.

---

## 16. Backups and recovery

See `DEPLOYMENT.md` §7 for procedures. Security-relevant properties: backups are
encrypted at rest, stored in a separate account/region from production, access-controlled
separately from the application's credentials, and **restore-tested quarterly**. An
untested backup is not a backup.

---

## 17. Reporting a vulnerability

Security issues go to `security@example.com`, not to the public issue tracker. We will
acknowledge within 3 working days. Please do not test against production accounts other
than your own, and do not access, modify or exfiltrate data belonging to other users.

---

## 18. Implementation checklist

Tracked as `SEC-*` tasks in `TASKS.md`.

- [x] Argon2id hashing with versioned parameters (`SEC-001`)
- [x] Hashed session tokens, secure cookie flags, rotation (`SEC-002`)
- [x] Hashed verification and reset tokens, single-use, expiring (`SEC-003`)
- [x] Workspace guard with 404-over-403 (`SEC-004`)
- [x] Prisma tenant-scoping extension (`SEC-005`)
- [x] Composite foreign keys on all tenant-owned children (`SEC-006`)
- [x] Generated cross-tenant isolation test suite (`SEC-007`)
- [ ] Permission guard + CI route-coverage check (`SEC-008`) — the admin guard fails
      closed on a missing permission (D-066); the customer-side CI check is still to do
- [x] Rate limiting on auth and upload endpoints (`SEC-009`)
- [ ] Security headers and CSP on all frontends (`SEC-010`)
- [ ] CSRF double-submit protection (`SEC-011`)
- [x] Private buckets, signed upload/download, allow-list, checksum verification (`SEC-012`)
      — plus magic-byte verification and quarantine on mismatch (DOC-101…104)
- [x] Resend webhook signature verification with replay protection (`SEC-013`)
- [x] Audit logging infrastructure (`SEC-014`)
- [x] Log redaction (`SEC-015`)
- [ ] Secret scanning and dependency audit in CI (`SEC-016`)
- [x] Admin 2FA (`SEC-017`) — mandatory, RFC 6238, no bypass in any environment
- [x] Support access grants (`SEC-018`) — reason, scope, ≤24 h expiry, every use audited
- [ ] Account deletion workflow (`SEC-019`)
