# Development review — 2026-09-20

## Scope and evidence

Repository inspection of INIT, TASKS, ARCHITECTURE, UI_UX, TESTING, dashboard routes,
API-client contracts, scripts and manifests. This is a development assessment, not a
backend security audit. UI-003 is the first user-prioritised redesign slice.

## Current state

The repository is a working modular monolith with five applications and shared packages,
not only a specification. Dashboard routes and API-client methods cover authentication,
workspaces, vehicles, mileage, service history and maintenance. The reminder, ownership,
document, report and settings destinations currently show explicit coming-soon screens.
TASKS records partial vehicle implementation separately from full task completion.

The shared semantic theme, component package, workspace-keyed queries and central typed
API client are useful foundations to extend. Maintenance values displayed by the redesigned
screen still come from the server. UI work does not add client-side financial calculations.

## Gaps to resolve before expanding scope

- Tracker summary is inconsistent with detailed rows: Phase 4 lists nine DONE tasks,
  whereas the aggregate reports eight later-phase completions. INIT still describes Phase 0.
  Reconcile documentation against acceptance evidence before estimating completion.
- UI-002 and WS-002 are still IN_PROGRESS. Existing shell actions are not consistently
  hidden by role. Menus/drawer use manual behaviour and need full keyboard/focus review.
  These are existing gaps, not evidence that backend permission checks are absent.
- Dashboard package `test` currently prints “no tests”. The standalone UI-003 browser
  verifier adds deterministic presentation checks but is not a real-stack E2E suite.
- Much of the existing JSX uses literal English copy despite the catalogue requirement.
  UI-003 centralises overview copy; a full localisation migration is separate work.
- The original global formatting failure was resolved in CORE-022: the 100 remaining
  files were formatted and the global gate now passes. All edits were checked against
  Prettier output from original snapshots; typecheck, lint, tests, isolation, build and
  the dashboard browser fixture verification pass.
- Production hardening, security review and deferred modules remain open. Passing unit
  checks does not establish release readiness.

## Recommended order

1. Review UI-003/UI-004 and reconcile tracker counts (DOC-007); CORE-022 cleared formatting.
2. Finish UI-002: accessible drawer/menus, role-aware actions and workspace-switch E2E
   verification alongside WS-002. Preserve server-side permission enforcement.
3. Complete the remaining vehicle-core acceptance criteria and their dependencies before
   treating partially delivered vehicle tasks as DONE.
4. Build REM-001/REM-002 once their dependency status is verified, then deliveries and
   notifications. Avoid adding more placeholder pages before the underlying flows exist.

## Verification of UI-003

- `pnpm typecheck --force`: 25 tasks passed, no cache.
- `pnpm lint --force`: 25 tasks passed, no cache.
- `pnpm test --force`: 271 tests passed across 10 test files; packages with no tests
  continue to report that explicitly.
- `pnpm build --force`: all application/package builds checked; see session report.
- `pnpm format:check`: initially failed on 102 existing files; passed globally after CORE-022.
- `node scripts/verify-dashboard-redesign.mjs`: API-fixture browser checks for light/dark
  at 360/768/1440 px, overflow, workspace visibility, skip-link focus, navigation,
  empty/loading/error states and retry. This does not verify backend integration.
