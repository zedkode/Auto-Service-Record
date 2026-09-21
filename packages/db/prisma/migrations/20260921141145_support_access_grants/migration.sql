-- CreateEnum
CREATE TYPE "SupportAccessScope" AS ENUM ('VEHICLE_CONTENT', 'DOCUMENTS', 'FULL');

-- CreateTable
CREATE TABLE "support_access_grants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "admin_user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "SupportAccessScope" NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_access_grants_admin_user_id_expires_at_idx" ON "support_access_grants"("admin_user_id", "expires_at");

-- CreateIndex
CREATE INDEX "support_access_grants_workspace_id_expires_at_idx" ON "support_access_grants"("workspace_id", "expires_at");

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
