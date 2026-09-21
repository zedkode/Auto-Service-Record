-- Extensions required by the schema. See DATABASE.md.
--   citext   : case-insensitive email columns
--   pg_trgm  : trigram indexes for partial/fuzzy search (ADR-009)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Integration tests run against a separate database (TEST_DATABASE_URL).
SELECT 'CREATE DATABASE autoservices_test OWNER autoservices'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'autoservices_test')\gexec
