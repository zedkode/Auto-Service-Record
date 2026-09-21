-- Invariants Prisma cannot express in schema.prisma. See DATABASE.md §4.2 and §6.

-- Exactly one ACTIVE OWNER per workspace. Any non-atomic ownership transfer now fails
-- loudly at the database rather than silently leaving a workspace with two owners (or none).
CREATE UNIQUE INDEX IF NOT EXISTS workspace_single_owner
  ON workspace_members (workspace_id)
  WHERE role = 'OWNER' AND status = 'ACTIVE';

-- Registration is unique per workspace among live vehicles, not globally: two workspaces
-- may legitimately track the same vehicle (a sale, a shared family car).
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_workspace_registration_uk
  ON vehicles (workspace_id, upper(registration_number))
  WHERE deleted_at IS NULL AND registration_number IS NOT NULL;

-- Hot path for the dashboard and for every maintenance computation.
CREATE INDEX IF NOT EXISTS vehicles_workspace_active_idx
  ON vehicles (workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Full-text search over vehicles (ADR-009: PostgreSQL search, not Elasticsearch).
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(manufacturer,'') || ' ' ||
      coalesce(model,'') || ' ' ||
      coalesce(trim,'') || ' ' ||
      coalesce(registration_number,'') || ' ' ||
      coalesce(vin,'')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS vehicles_search_idx ON vehicles USING GIN (search_vector);
