-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('MOT', 'ITP', 'TUV', 'CT', 'STATE_INSPECTION', 'EMISSIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'PASS_WITH_ADVISORIES', 'FAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AdvisorySeverity" AS ENUM ('MINOR', 'MAJOR', 'DANGEROUS');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('ONE_OFF', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "PolicyRenewalType" AS ENUM ('MANUAL', 'AUTOMATIC', 'UNKNOWN');

-- CreateTable
CREATE TABLE "vehicle_inspections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "inspection_type" "InspectionType" NOT NULL,
    "result" "InspectionResult" NOT NULL DEFAULT 'UNKNOWN',
    "performed_on" DATE NOT NULL,
    "expires_on" DATE,
    "odometer" INTEGER,
    "odometer_unit" "DistanceUnit",
    "contact_id" UUID,
    "centre_name" TEXT,
    "certificate_number" TEXT,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_advisories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "severity" "AdvisorySeverity" NOT NULL,
    "text" TEXT NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_service_record_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inspection_advisories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "contact_id" UUID,
    "provider_name" TEXT NOT NULL,
    "policy_number" TEXT,
    "cover_type" TEXT,
    "starts_on" DATE NOT NULL,
    "expires_on" DATE,
    "premium_amount" DECIMAL(14,2),
    "excess_amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "payment_frequency" "PaymentFrequency",
    "renewal_type" "PolicyRenewalType" NOT NULL DEFAULT 'UNKNOWN',
    "coverage_notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "road_tax_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'GB',
    "tax_type" TEXT,
    "reference" TEXT,
    "starts_on" DATE NOT NULL,
    "expires_on" DATE,
    "amount" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "payment_frequency" "PaymentFrequency",
    "notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "road_tax_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_inspections_workspace_id_vehicle_id_performed_on_idx" ON "vehicle_inspections"("workspace_id", "vehicle_id", "performed_on" DESC);

-- CreateIndex
CREATE INDEX "vehicle_inspections_expires_on_idx" ON "vehicle_inspections"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_inspections_id_workspace_uk" ON "vehicle_inspections"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "inspection_advisories_workspace_id_inspection_id_idx" ON "inspection_advisories"("workspace_id", "inspection_id");

-- CreateIndex
CREATE INDEX "inspection_advisories_workspace_id_is_resolved_idx" ON "inspection_advisories"("workspace_id", "is_resolved");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_advisories_id_workspace_uk" ON "inspection_advisories"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "insurance_policies_workspace_id_vehicle_id_starts_on_idx" ON "insurance_policies"("workspace_id", "vehicle_id", "starts_on" DESC);

-- CreateIndex
CREATE INDEX "insurance_policies_expires_on_idx" ON "insurance_policies"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_id_workspace_uk" ON "insurance_policies"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "road_tax_records_workspace_id_vehicle_id_starts_on_idx" ON "road_tax_records"("workspace_id", "vehicle_id", "starts_on" DESC);

-- CreateIndex
CREATE INDEX "road_tax_records_expires_on_idx" ON "road_tax_records"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "road_tax_records_id_workspace_uk" ON "road_tax_records"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_advisories" ADD CONSTRAINT "inspection_advisories_inspection_id_workspace_id_fkey" FOREIGN KEY ("inspection_id", "workspace_id") REFERENCES "vehicle_inspections"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_advisories" ADD CONSTRAINT "inspection_advisories_resolved_service_record_id_fkey" FOREIGN KEY ("resolved_service_record_id") REFERENCES "service_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_tax_records" ADD CONSTRAINT "road_tax_records_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "road_tax_records" ADD CONSTRAINT "road_tax_records_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
