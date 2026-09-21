# ADR-009 — PostgreSQL full-text search, not Elasticsearch

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

Users need to find things within their own workspace: a vehicle by registration or VIN, a
service by description, a part by part number, a workshop by name, a document by title.

The corpus is small — even a large fleet workspace holds a few thousand searchable rows —
and every search is already constrained by `workspace_id`, which eliminates the vast
majority of candidates before any text matching happens.

Search must never cross a tenant boundary.

## Decision

**PostgreSQL's built-in search**, specifically:

- a generated `tsvector` column on `vehicles` covering registration, VIN, manufacturer,
  model and notes, with a GIN index,
- `pg_trgm` trigram indexes on `service_records.description`, `service_parts.part_number`
  and `contacts.name`, for the partial and fuzzy matching those fields actually need,
- every search query workspace-scoped through the same tenant client as everything else.

Elasticsearch, OpenSearch, Typesense and Meilisearch are explicitly out of scope until a
measured requirement demands one.

## Alternatives considered

**Elasticsearch / OpenSearch.** Powerful, and entirely disproportionate here. It would add
a JVM service to operate, back up and secure; an indexing pipeline that can fall behind or
drift; and — most seriously — **a second copy of tenant data outside the database's
isolation guarantees**. Every one of the three isolation layers in ADR-002 would have to be
re-implemented for the search index. That is a large new attack surface in exchange for
sub-second search over a few thousand rows that Postgres already indexes well.

**Typesense / Meilisearch.** Much lighter than Elasticsearch and genuinely pleasant, with
typo tolerance out of the box. Still a second datastore holding tenant data, a second
isolation model, and a sync pipeline that can drift. The same objection applies at smaller
scale.

**`LIKE '%term%'` only.** Sufficient for registration lookup, useless for descriptions, and
unindexable without trigrams — which is exactly what we are adopting.

## Consequences

**Positive.** No new infrastructure. Search results are transactionally consistent with the
data — no indexing lag, no drift, no reindex job. Tenant isolation is inherited from the
existing layers, not reimplemented. Backup and restore cover search automatically.

**Negative.** No typo tolerance or semantic matching beyond what trigrams provide. Ranking
is simpler than a dedicated engine's. Cross-workspace platform-wide search in the admin app
will be slower and is deliberately limited to identifier lookup rather than free-text.
`tsvector` columns and GIN indexes add write overhead and storage — modest at this scale.

**Revisit if:** p95 search latency exceeds 500 ms on real data, users report relevance
problems that ranking tuning cannot fix, or a genuine full-corpus cross-tenant search
requirement appears. Until one of those is *measured*, this stays.
