
-- CreateIndex
CREATE INDEX "audit_logs_actor_admin_id_fk_idx" ON "audit_logs"("actor_admin_id");

-- CreateIndex
CREATE INDEX "documents_uploaded_by_user_id_fk_idx" ON "documents"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "email_messages_user_id_fk_idx" ON "email_messages"("user_id");

-- CreateIndex
CREATE INDEX "expenses_category_id_fk_idx" ON "expenses"("category_id");

-- CreateIndex
CREATE INDEX "expenses_created_by_user_id_fk_idx" ON "expenses"("created_by_user_id");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_user_id_fk_idx" ON "export_jobs"("requested_by_user_id");

-- CreateIndex
CREATE INDEX "fuel_entries_created_by_user_id_fk_idx" ON "fuel_entries"("created_by_user_id");

-- CreateIndex
CREATE INDEX "inspection_advisories_resolved_service_record_id_fk_idx" ON "inspection_advisories"("resolved_service_record_id");

-- CreateIndex
CREATE INDEX "insurance_policies_created_by_user_id_fk_idx" ON "insurance_policies"("created_by_user_id");

-- CreateIndex
CREATE INDEX "maintenance_completions_service_record_id_fk_idx" ON "maintenance_completions"("service_record_id", "workspace_id");

-- CreateIndex
CREATE INDEX "maintenance_rules_category_id_fk_idx" ON "maintenance_rules"("category_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_email_message_id_fk_idx" ON "notification_deliveries"("email_message_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_reminder_id_fk_idx" ON "notification_deliveries"("reminder_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_user_id_fk_idx" ON "notification_deliveries"("user_id");

-- CreateIndex
CREATE INDEX "notification_preferences_workspace_id_fk_idx" ON "notification_preferences"("workspace_id");

-- CreateIndex
CREATE INDEX "notifications_reminder_id_fk_idx" ON "notifications"("reminder_id");

-- CreateIndex
CREATE INDEX "odometer_entries_created_by_user_id_fk_idx" ON "odometer_entries"("created_by_user_id");

-- CreateIndex
CREATE INDEX "reminders_target_user_id_fk_idx" ON "reminders"("target_user_id");

-- CreateIndex
CREATE INDEX "road_tax_records_created_by_user_id_fk_idx" ON "road_tax_records"("created_by_user_id");

-- CreateIndex
CREATE INDEX "service_records_category_id_fk_idx" ON "service_records"("category_id");

-- CreateIndex
CREATE INDEX "service_records_created_by_user_id_fk_idx" ON "service_records"("created_by_user_id");

-- CreateIndex
CREATE INDEX "vehicle_inspections_created_by_user_id_fk_idx" ON "vehicle_inspections"("created_by_user_id");

-- CreateIndex
CREATE INDEX "warranties_created_by_user_id_fk_idx" ON "warranties"("created_by_user_id");

-- CreateIndex
CREATE INDEX "warranties_service_part_id_fk_idx" ON "warranties"("service_part_id", "workspace_id");

-- CreateIndex
CREATE INDEX "warranties_service_record_id_fk_idx" ON "warranties"("service_record_id", "workspace_id");

