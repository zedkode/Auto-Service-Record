-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'AVAILABLE', 'QUARANTINED', 'DELETED');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'RECEIPT', 'INSURANCE_POLICY', 'INSPECTION_CERTIFICATE', 'REGISTRATION', 'WARRANTY', 'MANUAL', 'PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentAttachmentType" AS ENUM ('VEHICLE', 'SERVICE_RECORD', 'VEHICLE_INSPECTION', 'INSURANCE_POLICY', 'ROAD_TAX_RECORD', 'EXPENSE');

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "uploaded_by_user_id" UUID,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "checksum_sha256" TEXT,
    "document_type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "document_date" DATE,
    "expires_on" DATE,
    "attached_to_type" "DocumentAttachmentType",
    "attached_to_id" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_workspace_id_created_at_idx" ON "documents"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_workspace_id_vehicle_id_created_at_idx" ON "documents"("workspace_id", "vehicle_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "documents_workspace_id_attached_to_type_attached_to_id_idx" ON "documents"("workspace_id", "attached_to_type", "attached_to_id");

-- CreateIndex
CREATE INDEX "documents_status_created_at_idx" ON "documents"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_workspace_uk" ON "documents"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
