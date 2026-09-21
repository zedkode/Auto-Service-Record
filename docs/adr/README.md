# Architecture Decision Records

An ADR records a decision that is expensive to reverse, together with the context that
made it reasonable. When someone asks "why is it like this?" two years from now, the
answer should be a file, not a memory.

**Format:** Context · Decision · Alternatives considered · Consequences.
**Statuses:** Proposed · Accepted · Superseded by ADR-NNN · Deprecated.

Write a new ADR when a decision changes the shape of the system, constrains future
options, or contradicts an existing ADR. Never edit an accepted ADR's decision — supersede
it with a new one. Smaller judgement calls go in `DECISIONS.md` instead.

| ADR | Title | Status |
| --- | --- | --- |
| [001](ADR-001-monorepo.md) | Monorepo with pnpm and Turborepo | Accepted |
| [002](ADR-002-multi-tenant-workspaces.md) | Workspace-based multi-tenancy in a shared database | Accepted |
| [003](ADR-003-rest-api.md) | REST with OpenAPI rather than GraphQL | Accepted |
| [004](ADR-004-background-jobs.md) | BullMQ on Redis for background work | Accepted |
| [005](ADR-005-object-storage.md) | S3-compatible object storage for documents | Accepted |
| [006](ADR-006-resend-email.md) | Resend behind an EmailService abstraction | Accepted |
| [007](ADR-007-modular-monolith.md) | Modular monolith instead of microservices | Accepted |
| [008](ADR-008-prisma-orm.md) | Prisma as the ORM | Accepted |
| [009](ADR-009-postgres-search.md) | PostgreSQL full-text search, not Elasticsearch | Accepted |
| [010](ADR-010-separate-frontends.md) | Three separate frontend applications | Accepted |
