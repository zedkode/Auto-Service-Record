# CLAUDE.md — Repository Instructions for Claude

`AGENTS.md` is the binding contract for all agents and applies to you in full. This file
adds Claude-specific working instructions. Where the two overlap, they agree; where this
file is more specific, follow it.

---

## Read first, every session

```text
INIT.md      → what we are building
AGENTS.md    → the rules
TASKS.md     → what to do next
```

Then read the domain document for the area you are touching. Do not skip this because
the task "looks small". Most expensive mistakes in this repository will come from
re-implementing something that already exists one directory over.

---

## Working method

**Inspect before editing.** Search for existing implementations, existing types, existing
Zod schemas and existing UI primitives before creating new ones. `packages/` exists
precisely so that the same concept is not defined five times.

**Prefer the shared package.** A validation schema belongs in `packages/validation`, a
button in `packages/ui`, a permission rule in `packages/permissions`, an env variable in
`packages/config`. If you write one inside an app, justify it.

**Keep apps independently deployable.** `apps/dashboard` must never import from
`apps/admin`. Cross-app sharing goes through `packages/`.

**Keep business logic out of components.** A React component renders state and dispatches
intent. It does not compute whether a service is overdue, convert kilometres to miles,
or decide whether a plan permits an action — the API returns those answers.

**Keep controllers thin.** NestJS controllers handle HTTP: parse, delegate, serialise.
Business rules live in services and are testable without an HTTP layer or a database
connection.

**Keep domain logic pure where possible.** Maintenance due-state, fuel economy, cost
aggregation and entitlement evaluation should be pure functions over plain inputs. That
is what makes them cheap to test exhaustively — and those are exactly the calculations
users will notice being wrong.

---

## Non-negotiables

- **Tenant data.** Never expose data from one workspace to another. Every tenant query
  is workspace-scoped at the data-access layer. When you add a tenant-owned model, add
  its isolation test in the same change.
- **Migrations.** Schema changes are Prisma migrations, committed with the code that
  needs them. Never edit a database directly. Never edit an already-applied migration.
- **Secrets.** Never in source files, tests, fixtures or docs. `.env.example` carries
  placeholder values only.
- **Money.** Decimal or integer minor units, always with a currency code. Never `number`
  arithmetic on prices.
- **Distance.** Always paired with a unit. `MILES` and `KILOMETERS` are stored, converted
  explicitly, and never compared raw.
- **Private documents.** Signed, expiring URLs only. No public bucket, no predictable
  object keys, no document served without a permission check.

---

## Ambiguity

When a task is ambiguous but not dangerous, choose the sensible option, implement it,
and write it down in `DECISIONS.md` with a one-paragraph rationale. Do not stop the work
to ask about minor implementation details — naming, column order, which of two
equivalent libraries, the exact copy of an empty state.

Escalate only for: irreversible data-model changes, anything affecting security or
tenant isolation, breaking changes to documented contracts, or genuinely divergent
product interpretations.

---

## Maintaining the repository's memory

After meaningful work:

1. Update `TASKS.md` — status, notes, newly-unblocked tasks, any new tasks discovered.
2. Update the affected domain document if behaviour or contracts changed.
3. Add to `DECISIONS.md` if you made a judgement call.
4. Add an ADR if you made an architectural choice.
5. Add to `CHANGELOG.md` if a user would notice.

`TASKS.md` records engineering work. `CHANGELOG.md` records product change. They are not
the same file and must not be merged.

---

## Commands

```bash
pnpm install                 # install workspace dependencies
docker compose up -d         # Postgres, Redis, MinIO, Mailpit
pnpm db:migrate              # apply Prisma migrations
pnpm db:seed                 # seed reference + demo data
pnpm dev                     # run all apps in watch mode
pnpm dev --filter api        # run one app

pnpm typecheck               # tsc --noEmit, all packages
pnpm lint                    # ESLint, zero warnings
pnpm format:check            # Prettier
pnpm test                    # unit + integration
pnpm test:isolation          # cross-tenant security suite
pnpm test:e2e                # Playwright
pnpm build                   # build every app
```

Run `typecheck`, `lint` and `test` before declaring anything finished, and report the
real output.

---

## Reporting

Close every significant session with the report format in `AGENTS.md` §8. A concise,
technically useful engineering report — what you found, what you changed, exact files,
schema changes, tests actually executed with results, task transitions, known issues,
and the next recommended task.
