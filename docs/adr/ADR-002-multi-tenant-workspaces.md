# ADR-002 — Workspace-based multi-tenancy in a shared database

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

The product must serve individuals, families, small businesses and fleets from one
system. A person may belong to several tenants (their own garage and their employer's
fleet) and switch between them. Tenants share nothing.

Cross-tenant data leakage is the failure this product cannot survive: it is a reportable
data breach, and it destroys the trust that makes anyone upload their vehicle documents
in the first place.

The naive model — `User → Vehicle` — cannot express shared access at all, and retrofitting
tenancy into a schema built that way means rewriting every table, every query and every
endpoint.

## Decision

**Workspace as the tenant boundary**, with `User ──< WorkspaceMember >── Workspace ──<
Vehicle`. Every user receives a Personal Garage workspace at registration. A workspace may
later represent a family, business, fleet or club without any schema change.

**Shared database, shared schema, `workspace_id` on every tenant-owned row**, with
isolation enforced in three independent layers:

1. `WorkspaceGuard` resolves and verifies membership per request (404, not 403, for
   non-members).
2. A Prisma client extension injects `workspaceId` into every query and create. The set of
   tenant-owned models is derived from the schema, so new models are covered automatically.
3. Composite foreign keys `(id, workspace_id)` let the database itself reject a
   cross-workspace parent/child pair.

## Alternatives considered

**Database per tenant.** The strongest isolation available, and genuinely correct for a
handful of large enterprise customers. Wrong here: a free-tier product expecting thousands
of personal garages would need thousands of databases, migrations would become a fleet
operation, connection pooling would collapse, and cross-tenant analytics would require a
separate pipeline. The operational cost is not proportionate to the risk given three
enforcement layers.

**Schema per tenant.** Same problems at slightly lower cost. Postgres degrades with very
large numbers of schemas, and Prisma has no first-class support for dynamic schema
switching.

**PostgreSQL Row-Level Security as the primary control.** Genuinely attractive — the
database enforces isolation regardless of application bugs. Rejected as *primary* because
it depends on setting a session variable per request (`SET LOCAL app.workspace_id`), which
interacts badly with connection pooling: a pooled connection carrying a stale setting is a
leak, and Prisma's transaction and connection-reuse model makes the guarantee hard to
verify. The extension approach gives an equivalent guarantee at the layer we can actually
test. **RLS remains available as a later hardening layer**, and the schema is already
shaped for it since every tenant row carries `workspace_id`.

**`user_id` on every row instead of `workspace_id`.** Simpler, and wrong. It makes sharing
impossible without a migration touching every table.

## Consequences

**Positive.** One database, one migration path, one connection pool. Sharing works from
day one at no extra cost. A user can belong to many workspaces. The model scales from one
personal garage to a 100-vehicle fleet with no structural change.

**Negative.** Isolation is the application's responsibility, so it must be tested
relentlessly — hence the generated isolation suite (SEC-007) as a blocking CI gate. A
single missed `where` clause is a critical bug, which is why there are three layers rather
than one. Some denormalisation: `workspace_id` appears on grandchild tables such as
`service_parts` where it is technically derivable. That cost is accepted deliberately — it
is what makes the composite foreign keys possible.

**Non-negotiable follow-ons.** SEC-005 (extension), SEC-006 (composite FKs), SEC-007
(generated isolation suite), and E2E-2 (cross-tenant access test). None may be deferred.
