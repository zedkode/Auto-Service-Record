# AGENTS.md — Operating Contract for Coding Agents

This file is binding for **every** automated or semi-automated contributor working in
this repository, regardless of vendor or model. Human contributors should follow it too.

---

## 1. Before writing any code

Read, in this order:

1. `INIT.md` — what the platform is and how it is built.
2. `AGENTS.md` — this file.
3. `TASKS.md` — find the task you are implementing, and its dependencies.
4. The documents relevant to your task:
   - touching data? `DATABASE.md`
   - touching HTTP? `API.md`
   - touching auth, tenancy or permissions? `SECURITY.md`
   - touching mail? `EMAILS.md`
   - touching UI? `UI_UX.md`
   - writing tests? `TESTING.md`

Then **inspect the existing code** in the area you are about to change. Reading three
files before editing one is cheap. Re-implementing a system that already exists is not.

---

## 2. The rules

These are not stylistic preferences. Violating them is a defect.

1. **Never duplicate an existing system.** If something similar exists, extend it or
   refactor it. If it genuinely must be replaced, write an ADR first.
2. **Never silently redesign architecture.** A deviation from `ARCHITECTURE.md` requires
   an ADR in `docs/adr/` and an entry in `DECISIONS.md`, in the same change.
3. **Never bypass tenant isolation.** Every query touching tenant data resolves through
   the workspace-scoped data access path. No raw `prisma.vehicle.findMany()` without a
   `workspaceId` predicate. No "I'll filter it in the service layer".
4. **Never trust the client for authorisation.** Hiding a button is not a permission
   check. Every mutation re-derives the actor's role server-side.
5. **Never commit secrets.** Not in source, not in tests, not in fixtures, not in
   documentation examples, not in `.env` (only `.env.example`, with placeholder values).
6. **Never leave the repository broken.** `pnpm typecheck && pnpm lint && pnpm test`
   must pass when you stop. If you cannot finish, revert to a working state and record
   the partial work in `TASKS.md` as `BLOCKED` with the reason.
7. **Never change the database schema by hand.** Schema changes are Prisma migrations,
   committed, reviewed, and reversible. Never run DDL against a shared environment.
8. **Never log secrets or personal data.** No passwords, tokens, session IDs, full
   document contents or raw email bodies in logs or audit metadata.
9. **Never use floating point for money.** Decimal columns and integer minor units only.
   See `DATABASE.md` §8.
10. **Never compare distance values without units.** Miles and kilometres are different
    types in this codebase. See `DATABASE.md` §9.

---

## 3. Scope discipline

**Implement one coherent task at a time.** Do not attempt the whole platform in one
uncontrolled pass.

- One task from `TASKS.md` per work session, or one tightly-coupled group with a shared
  acceptance criterion.
- Do not start a task whose `Dependencies` are not `DONE`.
- If you discover necessary work outside your task, **do not silently absorb it**. Add a
  new task to `TASKS.md` and either complete the current task around it or mark the
  current task `BLOCKED`.
- Refactoring adjacent code is allowed when it is required by the task. Opportunistic
  rewrites of unrelated modules are not.

---

## 4. Task lifecycle

```text
BACKLOG → READY → IN_PROGRESS → REVIEW → DONE
                       ↓
                    BLOCKED
```

1. Pick the highest-priority `READY` task with satisfied dependencies.
2. Set it `IN_PROGRESS` in `TASKS.md` **before** writing code.
3. Implement it.
4. Run the checks in §5.
5. Update documentation if behaviour, schema, contracts or architecture changed.
6. Set it `DONE`, and promote any newly-unblocked tasks from `BACKLOG` to `READY`.
7. Add a `CHANGELOG.md` entry if the change is user-visible.

Never delete a completed task. `DONE` tasks are the project's history.

---

## 5. Required checks

Before declaring any task complete:

```bash
pnpm typecheck        # tsc --noEmit across the workspace (TypeScript 7)
pnpm lint             # ESLint, zero warnings tolerated
pnpm format:check     # Prettier
pnpm test             # unit + integration for affected packages
pnpm build            # every app builds
```

> Linting runs typescript-eslint against a side-by-side TypeScript 6, pinned inside
> `packages/eslint-config`, because typescript-eslint does not yet support the TS 7 API
> (DECISIONS.md D-032). Builds and typechecks use TypeScript 7. This is deliberate.

For changes touching authentication, tenancy or permissions, additionally run the
security suite:

```bash
pnpm test:isolation   # cross-workspace access tests — must be green, no exceptions
```

Report the commands you actually ran and their real results. Never report a test as
passing that you did not run.

---

## 6. Definition of Done

A task is `DONE` only when **all** of the following hold:

- [ ] Implementation complete — no `TODO` markers standing in for required behaviour
- [ ] Types valid (`pnpm typecheck` clean)
- [ ] Lint clean (`pnpm lint`, zero warnings)
- [ ] Relevant tests written and passing
- [ ] Authorisation verified — every new endpoint has an explicit permission check
- [ ] Tenant isolation verified — every new tenant-owned query is workspace-scoped
- [ ] Errors handled and mapped to the standard error format (`API.md` §5)
- [ ] Loading states handled (UI)
- [ ] Empty states handled (UI)
- [ ] Responsive behaviour checked at mobile, tablet and desktop widths (UI)
- [ ] Accessibility basics: labels, focus order, keyboard operation (UI)
- [ ] Documentation updated
- [ ] `TASKS.md` updated
- [ ] No known regression introduced

"The code exists" is not Done.

---

## 7. Making decisions

When a task is ambiguous but not dangerous, **make a sensible engineering decision and
keep moving.** Record it in `DECISIONS.md` with the date, the options considered and the
reason. Do not stop to ask about naming, field ordering, minor UX details or library
choices already implied by `INIT.md` §5.

Stop and ask only when:

- the decision changes the data model in a way that is expensive to reverse,
- the decision affects security or tenant isolation,
- the decision changes a documented public contract,
- or two reasonable interpretations lead to materially different products.

---

## 8. Reporting

End every significant work session with this report. No exceptions, and never just
"Done."

```markdown
## What I found
## What I changed
## Files created
## Files modified
## Database changes
## Tests
## Task tracker
## Issues
## Next recommended task
```

Be specific. "Tests pass" is not a report; "`pnpm test --filter @autoservices/api` — 47
passed, 0 failed" is.

---

## 9. Code conventions

- **Naming:** `PascalCase` types and classes, `camelCase` values, `SCREAMING_SNAKE_CASE`
  enum members, `kebab-case` file names.
- **Modules:** one NestJS module per bounded context, exporting a service; modules
  communicate through services, never by reaching into another module's repository.
- **Errors:** throw domain errors from services; map to HTTP in an exception filter.
- **Validation:** Zod schemas in `packages/validation`, applied by a global pipe. No
  ad-hoc `if (!body.x)` validation in controllers.
- **Dates:** UTC timestamps for instants; `DATE` columns for calendar concepts such as
  expiry dates. Never convert a calendar date through a timezone.
- **Comments:** explain *why*, not *what*. Match the density of surrounding code.
- **Imports:** workspace packages by name (`@autoservices/db`), never by relative path
  across package boundaries.

---

## 10. Things that will get a change rejected

- A new endpoint with no permission check.
- A Prisma query on a tenant-owned model without a workspace predicate.
- A migration that drops or cascades historical data without an ADR.
- A secret, key or real email address in the diff.
- A frontend that computes maintenance due-state, currency conversion or entitlements.
- A new dependency that duplicates an existing one.
- A test that asserts nothing, or is skipped without an explanatory comment.
- Documentation left describing behaviour the change just removed.
