# AutoServices

**Multi-tenant vehicle management SaaS** — the complete, permanent history of a vehicle,
and the reminders that keep it from becoming expensive.

> **Project status: Phase 1 complete, Phase 2 in progress.**
> All five applications run locally against PostgreSQL, Redis, MinIO and Mailpit.
> You can register, sign in, add a vehicle and update its mileage for real.
> `TASKS.md` has the next task (`AUTH-002`).

---

## What it does

Keeps track of what was serviced, when, at what mileage, by whom and for how much — plus
inspection/MOT, insurance, road tax, warranty, tyres, fuel, expenses and documents — for
one car or a hundred vans. Then it tells the right people what is due before it is overdue,
in-app and by email.

Built around **workspaces**, not users, so a personal garage, a family, a business and a
fleet are the same product with different member lists.

## Applications

| App | Domain | Purpose |
| --- | --- | --- |
| `apps/marketing` | `www.` | Public website, SEO-optimised |
| `apps/dashboard` | `app.` | Customer application |
| `apps/admin` | `admin.` | Internal administration — a separate app, never a hidden route |
| `apps/api` | `api.` | NestJS modular monolith |
| `apps/worker` | — | BullMQ consumers and schedulers |

## Stack

TypeScript 7 · Node 26 · React 19 · Vite 8 · Tailwind 4 · NestJS 12 on Fastify 5 ·
PostgreSQL 18 · Prisma 7 · Redis 8 · BullMQ 6 · Resend · S3-compatible storage ·
pnpm 12 · Turborepo 2 · Vitest 5 · Playwright

## Getting started

```bash
npm install -g pnpm@12        # Node 26 no longer bundles Corepack

cp .env.example .env          # defaults work locally as-is
pnpm install
docker compose up -d          # postgres, redis, minio, mailpit
pnpm db:migrate               # apply migrations
pnpm db:seed                  # dev user + two vehicles with mileage history
pnpm build                    # api and worker run from dist/
pnpm dev:all                  # everything, one foreground process, Ctrl-C to stop
```

| Service | URL |
| --- | --- |
| Marketing | http://localhost:3100 |
| Dashboard | http://localhost:3101 |
| Admin | http://localhost:3102 |
| API health | http://localhost:4100/api/v1/health |
| Mailpit (all outbound email) | http://localhost:58025 |
| MinIO console | http://localhost:59001 |
| PostgreSQL | localhost:55432 |
| Redis | localhost:56379 |

**Development sign-in:** `andrei@autoservices.local` / `DevPassword123!`
The sign-in page also offers a one-click dev sign-in, which only exists while
`DEV_AUTH_ENABLED=true` and is refused outright in production.

Ports sit in a deliberately non-default block so this stack cannot collide with another
Postgres/Redis/MinIO already running on the machine. Change them in `.env`.

No cloud account and no API keys are needed for local development, and no local run can
email a real person — everything goes to Mailpit.

## Documentation

**Start here:** [`INIT.md`](INIT.md) — the technical specification.

| Document | Answers |
| --- | --- |
| [INIT.md](INIT.md) | What are we building and with what? |
| [PRODUCT.md](PRODUCT.md) | What must it do, for whom, and what is MVP? |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How do the pieces fit together? |
| [DATABASE.md](DATABASE.md) · [ERD](docs/database/erd.md) | What is the data model? |
| [API.md](API.md) | What are the HTTP contracts? |
| [SECURITY.md](SECURITY.md) | What are the threats and controls? |
| [EMAILS.md](EMAILS.md) | How does mail get sent and tracked? |
| [UI_UX.md](UI_UX.md) | What does it look like and why? |
| [TESTING.md](TESTING.md) | What do we test and how? |
| [DEPLOYMENT.md](DEPLOYMENT.md) | How does it run in production? |
| [ROADMAP.md](ROADMAP.md) | In what order do we build it? |
| [TASKS.md](TASKS.md) | What is the next unit of work? |
| [DECISIONS.md](DECISIONS.md) · [ADRs](docs/adr/) | Why is it like this? |

## Contributing

Every contributor — human or agent — follows [`AGENTS.md`](AGENTS.md). Claude
additionally follows [`CLAUDE.md`](CLAUDE.md).

The short version: read `INIT.md`, `AGENTS.md` and `TASKS.md`; take one `READY` task;
never bypass tenant isolation; never commit a secret; run `pnpm typecheck && pnpm lint &&
pnpm test` before you stop; update `TASKS.md` and the docs; report what you actually did.

Several documented security invariants are enforced by lint rather than review — the
Resend SDK is confined to its transport, `unscoped()` to admin and worker code,
`$queryRawUnsafe` is blocked, `dangerouslySetInnerHTML` is banned, and apps cannot import
from other apps. These are controls, not style preferences. Do not switch them off to
unblock a build.

## Commands

```bash
pnpm dev:all             # every app in one process, with prefixed logs
pnpm dev                 # turbo parallel dev (per-app watch)
pnpm dev --filter api    # one app
pnpm typecheck           # tsc --noEmit, all packages
pnpm lint                # ESLint, zero warnings tolerated
pnpm lint:fix            # autofix what can be autofixed
pnpm test                # unit + integration
pnpm test:isolation      # cross-tenant security suite — must stay green
pnpm test:e2e            # Playwright
pnpm build               # build everything
pnpm db:studio           # Prisma Studio
pnpm db:reset            # drop, migrate, seed (destroys local data)
```

## Security

Cross-workspace data leakage is treated as a critical bug, not a defect. Isolation is
enforced in three layers and proven by a generated test suite that blocks merge.
See [`SECURITY.md`](SECURITY.md). Report vulnerabilities to `security@example.com`, not
the issue tracker.

## Licence

Not yet determined. No licence is granted until one is added here.
