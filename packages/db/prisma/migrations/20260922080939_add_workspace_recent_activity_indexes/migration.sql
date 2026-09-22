-- CreateIndex
CREATE INDEX "odometer_entries_workspace_recent_idx" ON "odometer_entries"("workspace_id", "recorded_on" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "vehicle_inspections_workspace_recent_idx" ON "vehicle_inspections"("workspace_id", "performed_on" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_records_workspace_recent_idx" ON "vehicle_inspections"("workspace_id", "performed_on" DESC, "created_at" DESC);
