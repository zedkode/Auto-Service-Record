# ADR-004 — BullMQ on Redis for background work

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

Several things must happen outside the request cycle: sending email, scanning for due
reminders on a schedule, processing uploaded documents, generating reports and exports,
and periodic cleanup.

Two requirements dominate. **An HTTP request must never wait on a third-party email API** —
that turns a provider's bad afternoon into our outage. And **the nightly reminder scan must
be reliable**, because a silently failing scheduler produces no errors and no emails, and
users discover it by missing an MOT.

## Decision

**BullMQ on Redis**, consumed by a separate `worker` process with no HTTP ingress.

Six queues — `notifications`, `emails`, `documents`, `reports`, `maintenance`, `cleanup` —
each with an explicit retry count and backoff policy. Repeatable schedulers are defined
once in the worker. Every job must be idempotent; jobs carry deterministic IDs where
duplicate enqueues are possible.

Failed jobs surface in the admin application with their payload (redacted), error, attempt
count and a retry action.

## Alternatives considered

**pg-boss (jobs in PostgreSQL).** Genuinely appealing: no new infrastructure, and jobs
enqueue transactionally with the data change that caused them — which eliminates a real
class of bug where the row commits but the job does not. Rejected because Redis is already
required for rate limiting and session-adjacent caching, so BullMQ adds no new
infrastructure either; and because BullMQ's repeatable-job, backoff and observability
tooling is considerably more mature. We compensate for the lost transactional enqueue with
idempotency keys and a nightly reconciliation sweep that catches anything missed.

**Cloud queue services (SQS, Cloud Tasks).** Managed and durable, but introduce a
vendor dependency that `INIT.md` §10 explicitly avoids, and make local development depend
on a cloud account or an emulator.

**In-process scheduling (node-cron in the API).** Simplest, and wrong. It breaks the moment
there is more than one API replica — every replica runs every scheduled job — and it makes
email delivery latency part of API request latency.

**Kafka or a full event bus.** Vastly more capability than a reminder scheduler needs, with
operational cost to match.

## Consequences

**Positive.** Email never blocks a request. The worker scales independently of the API.
Retries, backoff and failure visibility come for free. Local development needs only the
Redis container already in Compose.

**Negative.** Redis becomes a critical dependency — job state lives there, so Redis
persistence must be configured (appendonly) and monitored. Enqueue is not transactional
with the database write, so a crash between commit and enqueue can drop a job; the nightly
reconciliation sweep exists specifically to catch that. Jobs must be written idempotently,
which is a real discipline cost on every job.

**Follow-ons.** Monitor queue depth, oldest-job age, and — critically — *completion* of the
nightly scan, not merely the absence of errors.
