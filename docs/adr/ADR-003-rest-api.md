# ADR-003 — REST with OpenAPI rather than GraphQL

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

One API serves three first-party frontends and, later, mobile clients and a public
developer API. The data model is highly relational and the access patterns are largely
predictable: list vehicles, read a vehicle with its recent activity, list services with
filters.

The API carries strict authorisation requirements — every field access is potentially a
tenant boundary.

## Decision

A **versioned REST API** at `/api/v1`, documented with **OpenAPI** generated from NestJS
decorators and Zod schemas, with `packages/api-client` generated from the emitted spec.

Conventions are fixed once and applied everywhere: one pagination style, one filter style,
one error envelope, one date format.

## Alternatives considered

**GraphQL.** Flexible field selection, one round trip for composite views, strong tooling.
Rejected for three reasons specific to this product. **Authorisation** becomes per-field
across an arbitrarily-shaped graph — exactly the surface where a tenant-isolation bug
hides, and much harder to prove correct than a per-endpoint guard plus a generated
isolation suite. **Query cost** is unbounded by default; a public API would need depth
limiting, complexity analysis and persisted queries before it could be exposed. **Caching**
at the HTTP layer largely stops working. Our clients are ours, their access patterns are
known, and none of GraphQL's strengths addresses a problem we actually have.

**tRPC.** Excellent end-to-end types with no code generation, and a serious contender given
a TypeScript monorepo. Rejected because it is not a good public HTTP contract: a future
developer API, mobile clients on other stacks, and third-party integrators all want a
documented, versioned, curl-able HTTP surface. OpenAPI generation gives us most of tRPC's
type safety without giving up that.

**REST without OpenAPI.** Documentation drifts from implementation within weeks. Generating
both the docs and the client from one source is what prevents that.

## Consequences

**Positive.** Every endpoint has one explicit permission check. HTTP caching, rate limiting
and observability work conventionally. The generated client cannot drift from the server.
Versioning is well understood.

**Negative.** Composite views need either multiple requests or purpose-built endpoints;
we accept purpose-built endpoints such as `/vehicles/:id/summary` and `/dashboard`.
Over-fetching is possible — mitigated by designing responses for their actual consumer.
Adding a field to a response requires a server change, where GraphQL would not.

**Follow-ons.** CI fails on a route without OpenAPI metadata. Breaking changes require
`/api/v2`; `v1` is additive-only.
