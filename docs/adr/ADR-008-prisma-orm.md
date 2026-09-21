# ADR-008 — Prisma as the ORM

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

The data layer carries the platform's most important security property: every tenant query
must be workspace-scoped. Whatever tool we choose must make that enforceable *centrally*,
not endpoint by endpoint.

Beyond that, we need strong TypeScript types derived from the schema, a reliable migration
workflow, and good ergonomics for the relational reads this product is mostly made of.

## Decision

**Prisma 7.10.x**, with:

- the schema in `packages/db/prisma/schema.prisma` as the single source of truth,
- **a client extension implementing tenant scoping** (`$extends` query middleware) —
  the deciding factor,
- the tenant-owned model set derived from the DMMF, so new models are protected
  automatically,
- Prisma Migrate for schema changes, with hand-written SQL appended for composite foreign
  keys, partial unique indexes and generated columns,
- `$queryRaw` tagged templates for the few aggregate queries that need real SQL.

Prisma 8.x is currently a release candidate; we pin 7.10.x and revisit after it is stable.

## Alternatives considered

**Drizzle ORM.** Excellent types, SQL-first, minimal runtime, and a genuinely close call.
Its query-building model gives more direct control over generated SQL. Rejected primarily
because Prisma's client extensions give a single, testable, schema-derived interception
point for tenant scoping, whereas Drizzle's approach would require discipline at every call
site or a hand-maintained wrapper — and a hand-maintained list of protected models is
exactly the thing that gets forgotten when someone adds a table at 6 p.m. on a Friday.
Prisma's migration tooling is also more mature.

**TypeORM.** Mature and feature-rich, but its decorator-driven model produces weaker type
inference, its migration generation is less reliable, and its maintenance cadence has been
uneven.

**Kysely.** A superb typed query builder with no ORM overhead. No migration tooling and no
central interception point; we would be building the parts we most need.

**Raw SQL with a thin mapper.** Maximum control, maximum opportunity for a missing `WHERE
workspace_id = $1`. Precisely the wrong trade for this product's dominant risk.

## Consequences

**Positive.** Tenant scoping is implemented once, derived from the schema, and covered by a
generated test suite. Types flow from the schema to the API to the client. Migrations are
versioned, reviewable and repeatable. Prisma Studio is a genuinely useful local tool.

**Negative.** Prisma generates SQL we do not hand-write, so query plans must be reviewed
against real data (HARD-005) and N+1 patterns watched for (HARD-004). Composite foreign
keys are not expressible in the Prisma schema and must be added as hand-written migration
SQL — a required step, enforced by a schema check in CI. The generated client adds bundle
weight to the API image. Some aggregate reports will need `$queryRaw`.

**Follow-ons.** SEC-005 (the extension) is the single most important file in the codebase.
SEC-006 (composite FKs) must accompany every new tenant-owned child table.
