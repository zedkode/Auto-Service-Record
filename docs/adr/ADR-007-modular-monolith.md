# ADR-007 — Modular monolith instead of microservices

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

The platform spans a couple of dozen bounded contexts: identity, tenancy, vehicles,
service, maintenance, reminders, documents, reporting, entitlements, administration.

The target scale is 10,000+ users with tens of thousands of vehicles. The dominant access
pattern is reads within a single tenant, with one scheduled write-heavy sweep per day. This
is, by modern standards, a small workload.

The team is small. The architecture must not consume its capacity on distributed-systems
overhead.

## Decision

**One deployable API** — a NestJS modular monolith with one module per bounded context —
plus **one independent worker process** sharing the same domain packages.

Modules communicate through injected services with explicit interfaces. **A module never
reaches into another module's repositories or tables.** That constraint is what keeps the
option of extraction open.

## Alternatives considered

**Microservices from the start.** Independent scaling and deployment, strong team
boundaries. Wrong for this system and this team: every cross-context operation becomes a
network call with partial-failure semantics; the registration transaction (user + profile +
workspace + membership + preferences + subscription) would become a distributed transaction
or a saga; local development would need an orchestrator; and tenant isolation would have to
be re-proven at every service boundary rather than in one data-access layer. We would be
paying the cost of a 200-engineer organisation to serve a workload that fits on one modest
server.

**Serverless functions.** Attractive operationally, but cold starts hurt an interactive
dashboard, connection pooling against Postgres needs a proxy, and long-running scheduled
sweeps fit awkwardly into execution limits.

**A single process handling both HTTP and jobs.** Simpler still, and rejected: a slow email
send or a heavy report would compete with request handling, and scheduled jobs would run
once per API replica. Splitting the worker out is the one separation that earns its cost
immediately.

## Consequences

**Positive.** One deployment, one log stream, one debugger. Cross-context operations are
ordinary function calls inside real database transactions. Tenant isolation is enforced in
one place and proven by one test suite. Local development is `pnpm dev`. Refactoring across
module boundaries is a normal code change.

**Negative.** The whole API scales as a unit — acceptable, since it is stateless and
replicas are cheap. A memory leak or crash in one module affects all of them. Module
boundaries are enforced by convention, lint rules and review rather than by the network, so
discipline is required: the moment a module imports another module's repository, the
extraction option quietly disappears.

**If extraction is ever needed**, the likely first candidates are the reporting module
(read-heavy, tolerant of a read replica) and document processing (CPU-bound, bursty). Both
are already isolated behind service interfaces, so extraction would be mechanical rather
than architectural.
