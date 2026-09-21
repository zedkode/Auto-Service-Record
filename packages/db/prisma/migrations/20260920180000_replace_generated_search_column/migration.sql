-- Replace the generated tsvector column with trigram indexes.
--
-- WHY: Prisma Migrate cannot model a GENERATED column. It repeatedly tried to drop or
-- alter it, which blocked every subsequent migration. Trigram indexes on the underlying
-- columns give the same lookup capability (registration, VIN, make, model) with partial
-- and fuzzy matching, and Prisma leaves them alone. See ADR-009 and DECISIONS.md D-034.
DROP INDEX IF EXISTS vehicles_search_idx;

ALTER TABLE vehicles DROP COLUMN IF EXISTS search_vector;

CREATE INDEX IF NOT EXISTS vehicles_manufacturer_trgm_idx
  ON vehicles USING GIN (manufacturer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicles_model_trgm_idx
  ON vehicles USING GIN (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicles_registration_trgm_idx
  ON vehicles USING GIN (registration_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicles_vin_trgm_idx
  ON vehicles USING GIN (vin gin_trgm_ops);
