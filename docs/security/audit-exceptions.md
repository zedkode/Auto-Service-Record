# Dependency audit exceptions

`pnpm audit --audit-level high` blocks CI. Two advisories are suppressed in
`package.json` under `pnpm.auditConfig.ignoreGhsas`. Both are transitive through
`@prisma/client → prisma`, neither is reachable from this codebase, and neither can be
fixed here until Prisma ships an update.

Each entry must say why it is ignored and what would end the exception. An entry with no
expiry condition is a permanent hole wearing a comment.

| Advisory | Package | Path | Why it is ignored | Ends when |
| --- | --- | --- | --- | --- |
| [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | `deepmerge-ts` | `@prisma/client → prisma → @prisma/config → deepmerge-ts` | Stack exhaustion when merging recursive objects. Reached only by Prisma's own config loader, at build time, over `prisma.config.ts` — a file in this repository, not user input. | Prisma depends on `deepmerge-ts >= 8`. Re-check on every Prisma upgrade. |
| [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) | `mysql2` | `@prisma/client → prisma → mysql2` | Auth plugin downgrade leaking credentials to a hostile MySQL server. **This platform does not use MySQL** — the driver is pulled in by Prisma's multi-database CLI and is never loaded. There is no MySQL connection to downgrade. | Prisma depends on `mysql2 >= 3.22`, or stops bundling it. |

## Reviewing this list

- Re-read it on every Prisma upgrade; both entries are expected to disappear then.
- An advisory in a package this codebase **calls** is never suppressed here — it is fixed,
  as `nodemailer` was (7.0.9 → 10.0.10, three high advisories in a directly used
  dependency).
- `moderate` and `low` advisories do not block CI and are not listed; they are reviewed in
  the periodic dependency sweep (`HARD-004`).
