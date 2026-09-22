-- The previous migration created `service_records_workspace_recent_idx` on
-- `vehicle_inspections` by mistake, so `service_records` gained no index and
-- `vehicle_inspections` gained a duplicate of one it already had. Index names are unique
-- per schema, so the misplaced one must be dropped before the correct one can be created.
--
-- The earlier migration is left exactly as it was applied: a migration that has run
-- anywhere is history, and history gets a correction, not an edit.
DROP INDEX IF EXISTS "service_records_workspace_recent_idx";

CREATE INDEX "service_records_workspace_recent_idx" ON "service_records"("workspace_id", "performed_on" DESC, "created_at" DESC);
