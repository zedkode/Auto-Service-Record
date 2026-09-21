# DEPLOYMENT.md — Environments, Deployment & Operations

**Status:** Living document · **Version:** 1.0 · **Updated:** 2026-09-20

---

## 1. Local development

### 1.1 Prerequisites

Node.js 26.x, pnpm 12.x (`npm install -g pnpm@12` — Node 26 no longer bundles Corepack),
Docker with Compose v5, Git.

### 1.2 First run

```bash
git clone <repository-url> autoservices
cd autoservices

cp .env.example .env            # defaults work for local development as-is
# Generate real secrets — the config validator refuses the placeholders:
#   SESSION_SECRET  : openssl rand -base64 48
#   IP_HASH_SALT    : openssl rand -base64 32

npm install -g pnpm@12          # Node 26 no longer bundles Corepack
pnpm install                    # postinstall regenerates the Prisma client
docker compose up -d            # postgres, redis, minio, mailpit
pnpm db:migrate                 # apply Prisma migrations
pnpm db:seed                    # dev user, workspace and two vehicles
pnpm build                      # api and worker run from dist/
pnpm dev:all                    # everything in one process; Ctrl-C stops it all
```

`pnpm dev:all` refuses to start if a port is taken or if Postgres/Redis are not up, rather
than failing halfway through with a confusing error.

### 1.3 What runs where

| Service | URL | Notes |
| --- | --- | --- |
| Marketing | http://localhost:3100 | |
| Dashboard | http://localhost:3101 | |
| Admin | http://localhost:3102 | separate origin and auth realm |
| API | http://localhost:4100 | prefix `/api/v1` |
| Worker | — | logs to stdout, no ingress |
| PostgreSQL | localhost:55432 | `autoservices` / `autoservices` / `autoservices` |
| Redis | localhost:56379 | |
| MinIO | localhost:59000 (console :59001) | `minioadmin` / `minioadmin`, bucket is private |
| Mailpit | localhost:58025 (SMTP :51025) | every outbound email lands here |

Ports are in a non-default block so the stack cannot collide with another
Postgres/Redis/MinIO/Mailpit already running on a developer machine (DECISIONS.md D-025).
Override any of them in `.env`; container-internal ports are unchanged.

**No cloud account is required for local development.** No Resend key, no AWS credentials,
no external service. A developer with Docker and this repository has a complete working
system, and no local run can email a real person.

### 1.4 Useful commands

```bash
pnpm dev --filter api             # one app
pnpm db:studio                    # Prisma Studio
pnpm db:reset                     # drop, migrate, seed — destroys local data
pnpm db:migrate:dev --name <name> # create a migration from schema changes
docker compose logs -f worker
docker compose down -v            # stop and wipe volumes
```

---

## 2. Environments

| Environment | Purpose | Data | Deploys |
| --- | --- | --- | --- |
| Local | Development | Synthetic seed | — |
| CI | Automated verification | Ephemeral | Every push |
| Staging | Pre-production verification | Anonymised or synthetic | Automatic from `main` |
| Production | Live | Real | Manual promotion from staging |

**Production data is never copied to staging or local.** Staging is seeded with generated
data. If reproducing a production issue needs real shapes, the data is anonymised by a
committed, reviewed script — never by hand, never by `pg_dump` to a laptop.

---

## 3. Production architecture

```text
                      Internet
                          │
                   ┌──────▼──────┐
                   │ Reverse      │  TLS termination, HTTP/2, rate limiting,
                   │ proxy / CDN  │  security headers, static asset caching
                   └──────┬───────┘
      ┌───────────┬───────┼───────────┬──────────────┐
      │           │       │           │              │
   www.*       app.*   admin.*      api.*      (docs.*, status.*)
  ┌──────┐   ┌───────┐ ┌───────┐  ┌────────┐
  │static│   │static │ │static │  │  API   │ ×N replicas, stateless
  │ SSG  │   │ SPA   │ │ SPA   │  │ Node   │
  └──────┘   └───────┘ └───────┘  └───┬────┘
                                      │
              ┌──────────┬────────────┼────────────┬──────────────┐
              │          │            │            │              │
        ┌─────▼────┐ ┌───▼───┐  ┌─────▼─────┐ ┌────▼────┐  ┌──────▼─────┐
        │PostgreSQL│ │ Redis │  │S3 storage │ │ Worker  │  │  Resend    │
        │ primary  │ │       │  │  private  │ │ ×M      │  │            │
        │ +replica │ │       │  │           │ │no ingress│ │            │
        └──────────┘ └───────┘  └───────────┘ └─────────┘  └────────────┘
```

**Properties.** The three frontends are static bundles on a CDN. The API is stateless and
horizontally scalable — sessions live in Postgres, not in process memory. The worker has
no ingress and scales independently. Nothing is vendor-specific: Postgres, Redis and an
S3-compatible API are available from every serious host, and the reverse proxy is
interchangeable.

**Scaling path.** Vertical first (this workload fits comfortably on modest hardware at
10,000 users). Then API replicas, then a read replica for reports, then worker replicas
per queue. Splitting a module into a service is possible along existing module boundaries
but is not anticipated.

---

## 4. Containers

| Image | Base | Contents |
| --- | --- | --- |
| `autoservices/api` | `node:26-alpine` | API, multi-stage build, non-root user |
| `autoservices/worker` | `node:26-alpine` | Worker, shares the API build stage |
| `autoservices/marketing` | `nginx:alpine` | Static output |
| `autoservices/dashboard` | `nginx:alpine` | Static output |
| `autoservices/admin` | `nginx:alpine` | Static output |

Dockerfiles live in `infrastructure/docker/`. Multi-stage: dependency install → build →
a minimal runtime stage containing only production dependencies and built output.

Requirements: run as a non-root user; no build tooling in the final image; `HEALTHCHECK`
hitting `/health/live`; images tagged with the Git SHA, never only `latest`; graceful
shutdown on `SIGTERM` — the API drains connections, the worker finishes its current job
and stops accepting new ones.

---

## 5. Release procedure

```text
1. CI green on main  (lint, typecheck, unit, integration, isolation, e2e, audit)
2. Build and tag images with the commit SHA
3. Deploy to staging
4. Run smoke tests against staging
5. Apply migrations:  prisma migrate deploy   ← a discrete, logged step
6. Deploy API (rolling), then worker, then static frontends
7. Verify /health/ready, queue depth, error rate for 15 minutes
8. Tag the release and update CHANGELOG.md
```

**Migrations never run at application boot.** Two API replicas starting simultaneously
would race. `prisma migrate deploy` is an explicit release step, run once, by one process.

**Backward compatibility is required for a rolling deploy.** During the rollout, old and
new code run against the same schema. Every migration must be compatible with the
currently-deployed code: add columns nullable, backfill, switch reads, then tighten in a
later release. Never drop a column in the same release that stops writing to it.

**Rollback.** Application: redeploy the previous image tag — always safe. Schema: forward
fixes only. A migration that cannot be rolled forward safely should not have shipped; this
is precisely why expand/contract is mandatory.

---

## 6. Configuration

All configuration comes from the environment, validated by `packages/config` at startup
with Zod. **The application refuses to start** when a required variable is missing,
malformed, or still set to an `.env.example` placeholder — failing at boot is vastly
better than discovering at 3 a.m. that reminder emails have silently gone nowhere for a
week.

Secrets come from the platform's secret store, never from a file in the image, never from
the repository. Rotation is supported without downtime for the session secret (two active
keys during rotation), the webhook secret and storage credentials.

See `.env.example` for the full catalogue.

---

## 7. Backups

| Asset | Method | Frequency | Retention |
| --- | --- | --- | --- |
| PostgreSQL | Base backup + WAL archiving (PITR) | Continuous | 30 days |
| PostgreSQL | Full logical dump | Nightly | 30 daily, 12 monthly |
| Object storage | Versioning + cross-region replication | Continuous | 90 days for deleted versions |
| Secrets | Secret manager's own versioning | — | — |

Properties: encrypted at rest and in transit; stored in a separate account/region from
production; access-controlled separately from application credentials; the application's
own credentials **cannot** delete backups.

**Restore procedure** (documented in `docs/deployment/restore-runbook.md`):

1. Provision an isolated database instance.
2. Restore the base backup, replay WAL to the target timestamp.
3. Verify: row counts against expectations, latest `audit_logs` timestamp, a sample
   workspace's data integrity, a service-record → vehicle → workspace chain.
4. Point a staging API at the restored database and run the smoke suite.
5. Only then consider promoting.

**Restores are tested quarterly, and the test is recorded** with date, RTO achieved, RPO
achieved and any problems found. *A backup that has never been restored is not a backup —
it is an untested assumption.*

**Targets:** RPO ≤ 5 minutes (WAL archiving), RTO ≤ 2 hours.

---

## 8. Monitoring and alerting

**Health endpoints.** `/health` (cheap liveness), `/health/live` (event loop responsive),
`/health/ready` (Postgres, Redis and S3 reachable, with per-check detail). Readiness is
what the load balancer polls; liveness is what the orchestrator restarts on.

**Alert on:**

| Condition | Severity |
| --- | --- |
| API 5xx rate > 1% over 5 min | Page |
| `/health/ready` failing on > 50% of replicas | Page |
| Database connections > 80% of pool | Page |
| Worker heartbeat absent > 5 min | Page |
| Queue depth > 1000 or oldest job > 30 min | Warn |
| Job failure rate > 5% | Warn |
| Email bounce rate > 5% over 1 h | Warn |
| Nightly reminder scan did not complete | Page |
| Disk > 80%, or storage growth anomaly | Warn |
| Certificate expiring < 14 days | Warn |

**The reminder scan alert matters more than it looks.** A silently failing scheduler
produces no errors and no emails; users discover it when they miss an MOT. Absence of
work is monitored as actively as failure.

**Logs.** Structured JSON to stdout, collected by the platform, 30-day retention, with a
redaction list (`SECURITY.md` §14). Every line carries the correlation ID, so one
identifier traces request → reminder → job → email → webhook.

---

## 9. Incident response

1. **Acknowledge** and open an incident channel.
2. **Assess:** what is broken, who is affected, is data at risk.
3. **Mitigate first.** Roll back the deploy, scale, or disable the feature flag. Diagnose
   afterwards.
4. **Communicate** at a cadence, even when the update is "still investigating".
5. **Resolve and verify** with real user-facing checks, not just green dashboards.
6. **Blameless postmortem** within 5 working days for anything customer-affecting.

**Any suspected cross-tenant data exposure is automatically the highest severity**,
regardless of how few records are involved. Response: take the affected endpoint out of
service, determine scope from audit logs, preserve evidence, notify affected users, and
report to the supervisory authority within 72 hours if the GDPR threshold is met.

---

## 10. Cost and capacity notes

At 10,000 users and ~25,000 vehicles this workload is small: a few GB of relational data,
storage dominated by documents, and traffic dominated by the nightly reminder sweep.

Sizing guidance for that scale: 2 API replicas (1 vCPU / 1 GB each), 1 worker (1 vCPU /
1 GB), Postgres 2 vCPU / 4 GB with 100 GB storage, Redis 1 GB. Object storage grows with
customer documents and is the main variable cost.

The scheduler is the only workload with a sharp peak; the timezone-bucketed hourly design
(`ARCHITECTURE.md` §12) spreads it deliberately rather than doing everything at midnight
UTC.
