-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OK', 'DUE_SOON', 'DUE', 'OVERDUE');

-- CreateEnum
CREATE TYPE "MaintenanceIntervalType" AS ENUM ('TIME_BASED', 'DISTANCE_BASED', 'COMBINED');

-- DropIndex
DROP INDEX IF EXISTS "vehicles_manufacturer_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "vehicles_model_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "vehicles_registration_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "vehicles_vin_trgm_idx";

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_interval_km" INTEGER,
    "default_interval_months" INTEGER,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "performed_on" DATE NOT NULL,
    "odometer" INTEGER,
    "odometer_unit" "DistanceUnit",
    "category_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "contact_id" UUID,
    "workshop_name" TEXT,
    "mechanic_name" TEXT,
    "parts_total" DECIMAL(14,2),
    "labour_total" DECIMAL(14,2),
    "tax_total" DECIMAL(14,2),
    "total_amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "warranty_months" INTEGER,
    "next_service_on" DATE,
    "next_service_odometer" INTEGER,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_record_parts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "service_record_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "manufacturer" TEXT,
    "part_number" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "warranty_months" INTEGER,
    "supplier_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_record_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_rules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "interval_type" "MaintenanceIntervalType" NOT NULL DEFAULT 'COMBINED',
    "interval_distance" INTEGER,
    "interval_distance_unit" "DistanceUnit",
    "interval_months" INTEGER,
    "threshold_distance" INTEGER,
    "threshold_days" INTEGER,
    "last_completed_on" DATE,
    "last_completed_odometer" INTEGER,
    "last_completed_unit" "DistanceUnit",
    "next_due_on" DATE,
    "next_due_odometer" INTEGER,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OK',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_user_overridden" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_completions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "completed_on" DATE NOT NULL,
    "odometer" INTEGER,
    "odometer_unit" "DistanceUnit",
    "service_record_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_categories_workspace_id_idx" ON "service_categories"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_workspace_id_key_key" ON "service_categories"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "service_records_workspace_id_vehicle_id_performed_on_idx" ON "service_records"("workspace_id", "vehicle_id", "performed_on" DESC);

-- CreateIndex
CREATE INDEX "service_records_workspace_id_category_id_idx" ON "service_records"("workspace_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_records_id_workspace_uk" ON "service_records"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "service_record_parts_workspace_id_service_record_id_idx" ON "service_record_parts"("workspace_id", "service_record_id");

-- CreateIndex
CREATE INDEX "maintenance_rules_workspace_id_vehicle_id_is_active_idx" ON "maintenance_rules"("workspace_id", "vehicle_id", "is_active");

-- CreateIndex
CREATE INDEX "maintenance_rules_status_next_due_on_idx" ON "maintenance_rules"("status", "next_due_on");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_rules_id_workspace_uk" ON "maintenance_rules"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "maintenance_completions_workspace_id_rule_id_completed_on_idx" ON "maintenance_completions"("workspace_id", "rule_id", "completed_on" DESC);

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_record_parts" ADD CONSTRAINT "service_record_parts_service_record_id_workspace_id_fkey" FOREIGN KEY ("service_record_id", "workspace_id") REFERENCES "service_records"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_rules" ADD CONSTRAINT "maintenance_rules_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_rules" ADD CONSTRAINT "maintenance_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_completions" ADD CONSTRAINT "maintenance_completions_rule_id_workspace_id_fkey" FOREIGN KEY ("rule_id", "workspace_id") REFERENCES "maintenance_rules"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_completions" ADD CONSTRAINT "maintenance_completions_service_record_id_workspace_id_fkey" FOREIGN KEY ("service_record_id", "workspace_id") REFERENCES "service_records"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
