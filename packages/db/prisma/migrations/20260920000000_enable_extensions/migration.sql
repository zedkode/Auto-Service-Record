-- Extensions the schema depends on. These live in a migration rather than only in the
-- Docker init script so that migrations are self-contained: Prisma's shadow database,
-- CI, and any fresh production database all get them without out-of-band setup.
--
-- Named to sort before the initial migration so it always runs first.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
