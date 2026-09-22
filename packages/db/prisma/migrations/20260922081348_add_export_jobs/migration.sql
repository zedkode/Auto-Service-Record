-- CreateEnum
CREATE TYPE "ExportKind" AS ENUM ('EXPENSES', 'SERVICES', 'FUEL', 'ODOMETER', 'VEHICLES');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "requested_by_user_id" UUID,
    "kind" "ExportKind" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "object_key" TEXT,
    "filename" TEXT,
    "byte_size" INTEGER,
    "row_count" INTEGER,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_jobs_workspace_id_created_at_idx" ON "export_jobs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "export_jobs_status_expires_at_idx" ON "export_jobs"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_id_workspace_uk" ON "export_jobs"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
