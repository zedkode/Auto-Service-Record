# ADR-001 — Monorepo with pnpm and Turborepo

**Status:** Accepted · **Date:** 2026-09-20 · **Deciders:** Platform architecture

## Context

The platform comprises five deployable applications (marketing, dashboard, admin, API,
worker) that must share types, validation schemas, permission rules and UI components.
The single highest-value sharing is the **contract between the API and its clients**: if
a Zod schema, a permission rule or an error code can drift between server and client, it
will, and the resulting bugs are found by users rather than by CI.

The team is small. Coordinating a breaking change across five repositories with
independent release cycles would dominate the cost of every change.

## Decision

A single repository containing all applications and shared packages, using **pnpm
workspaces** for dependency resolution and **Turborepo** for task orchestration and
caching.

Dependency direction is strictly one-way: apps depend on packages, packages depend on
packages, nothing depends on an app. Cross-app imports are a lint error.

## Alternatives considered

**Polyrepo with published packages.** Proper versioning and independent release cadence,
but every shared-type change becomes publish → bump → install across up to five
repositories. For a team of this size, the overhead is larger than the benefit, and the
practical outcome is that people stop updating shared packages.

**Monorepo with npm/yarn workspaces.** Workable, but pnpm's content-addressed store is
meaningfully faster and its strict `node_modules` layout prevents phantom dependencies —
a package can only import what it actually declares. That strictness catches real bugs.

**Nx instead of Turborepo.** More capable: generators, dependency graph analysis, more
sophisticated caching. Also a much larger concept surface. Turborepo does the two things
we need (task graph, caching) with a configuration file people can read in a minute.
Nx remains a reasonable migration if the repository grows well beyond its current scope.

**Monorepo without an orchestrator.** Plain pnpm scripts work until the task graph has
real dependencies; then everything rebuilds on every change and CI takes fifteen minutes.

## Consequences

**Positive.** Atomic cross-cutting changes — an API contract change and its client update
land in one reviewable commit. One lint, format and TypeScript configuration. CI verifies
the whole system together. New contributors clone one thing.

**Negative.** The repository grows large; a shallow clone or sparse checkout may eventually
be needed. Turborepo caching must be configured correctly or CI is slower than it should
be. A broken shared package breaks everything at once — mitigated by the CI gate.

**Follow-on requirements.** Remote caching in CI (CORE-020). Lint rules enforcing
dependency direction (CORE-003). `packageManager` pinned in the root `package.json` so
everyone uses the same pnpm.
