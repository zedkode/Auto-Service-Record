
-- CreateEnum
CREATE TYPE "WarrantyType" AS ENUM ('MANUFACTURER', 'DEALER', 'THIRD_PARTY', 'PART', 'REPAIR');

-- CreateTable
CREATE TABLE "warranties" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "warranty_type" "WarrantyType" NOT NULL,
    "provider_name" TEXT,
    "contact_id" UUID,
    "reference" TEXT,
    "starts_on" DATE NOT NULL,
    "expires_on" DATE,
    "distance_limit" INTEGER,
    "distance_limit_unit" "DistanceUnit",
    "start_odometer" INTEGER,
    "start_odometer_unit" "DistanceUnit",
    "coverage_notes" TEXT,
    "service_record_id" UUID,
    "service_part_id" UUID,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warranties_workspace_id_vehicle_id_expires_on_idx" ON "warranties"("workspace_id", "vehicle_id", "expires_on" DESC);

-- CreateIndex
CREATE INDEX "warranties_expires_on_idx" ON "warranties"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_id_workspace_uk" ON "warranties"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_record_parts_id_workspace_uk" ON "service_record_parts"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_service_record_id_workspace_id_fkey" FOREIGN KEY ("service_record_id", "workspace_id") REFERENCES "service_records"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_service_part_id_workspace_id_fkey" FOREIGN KEY ("service_part_id", "workspace_id") REFERENCES "service_record_parts"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

