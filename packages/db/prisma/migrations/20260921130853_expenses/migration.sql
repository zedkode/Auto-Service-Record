-- CreateEnum
CREATE TYPE "ExpenseSourceType" AS ENUM ('MANUAL', 'SERVICE', 'FUEL', 'INSURANCE', 'TAX', 'OTHER');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "category_id" UUID,
    "incurred_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "vendor_name" TEXT,
    "contact_id" UUID,
    "odometer" INTEGER,
    "odometer_unit" "DistanceUnit",
    "description" TEXT,
    "source_type" "ExpenseSourceType" NOT NULL DEFAULT 'MANUAL',
    "source_record_id" UUID,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_workspace_id_idx" ON "expense_categories"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_workspace_id_key_key" ON "expense_categories"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "expenses_workspace_id_incurred_on_idx" ON "expenses"("workspace_id", "incurred_on" DESC);

-- CreateIndex
CREATE INDEX "expenses_workspace_id_vehicle_id_incurred_on_idx" ON "expenses"("workspace_id", "vehicle_id", "incurred_on" DESC);

-- CreateIndex
CREATE INDEX "expenses_workspace_id_category_id_idx" ON "expenses"("workspace_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_id_workspace_uk" ON "expenses"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_source_uk" ON "expenses"("source_type", "source_record_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
