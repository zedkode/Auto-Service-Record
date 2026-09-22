
-- CreateEnum
CREATE TYPE "TyreSeason" AS ENUM ('SUMMER', 'WINTER', 'ALL_SEASON');

-- CreateEnum
CREATE TYPE "TyreSetStatus" AS ENUM ('IN_USE', 'STORED', 'RETIRED');

-- CreateEnum
CREATE TYPE "TyrePosition" AS ENUM ('ALL_ROUND', 'FRONT_AXLE', 'REAR_AXLE', 'FRONT_LEFT', 'FRONT_RIGHT', 'REAR_LEFT', 'REAR_RIGHT', 'SPARE');

-- CreateTable
CREATE TABLE "tyre_sets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "size" TEXT,
    "season" "TyreSeason" NOT NULL,
    "load_index" TEXT,
    "speed_rating" TEXT,
    "purchased_on" DATE,
    "purchase_price" DECIMAL(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "status" "TyreSetStatus" NOT NULL DEFAULT 'STORED',
    "notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tyre_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tyre_installations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "tyre_set_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "position" "TyrePosition" NOT NULL DEFAULT 'ALL_ROUND',
    "installed_on" DATE NOT NULL,
    "installed_odometer" INTEGER,
    "removed_on" DATE,
    "removed_odometer" INTEGER,
    "odometer_unit" "DistanceUnit" NOT NULL,
    "tread_depth_mm" DECIMAL(4,1),
    "tread_measured_on" DATE,
    "service_record_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tyre_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tyre_sets_workspace_id_vehicle_id_status_idx" ON "tyre_sets"("workspace_id", "vehicle_id", "status");

-- CreateIndex
CREATE INDEX "tyre_sets_created_by_user_id_fk_idx" ON "tyre_sets"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_sets_id_workspace_uk" ON "tyre_sets"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "tyre_installations_workspace_id_vehicle_id_installed_on_idx" ON "tyre_installations"("workspace_id", "vehicle_id", "installed_on" DESC);

-- CreateIndex
CREATE INDEX "tyre_installations_workspace_id_tyre_set_id_idx" ON "tyre_installations"("workspace_id", "tyre_set_id");

-- CreateIndex
CREATE INDEX "tyre_installations_service_record_id_fk_idx" ON "tyre_installations"("service_record_id");

-- CreateIndex
CREATE INDEX "tyre_installations_created_by_user_id_fk_idx" ON "tyre_installations"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tyre_installations_id_workspace_uk" ON "tyre_installations"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_sets" ADD CONSTRAINT "tyre_sets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_installations" ADD CONSTRAINT "tyre_installations_tyre_set_id_workspace_id_fkey" FOREIGN KEY ("tyre_set_id", "workspace_id") REFERENCES "tyre_sets"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_installations" ADD CONSTRAINT "tyre_installations_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_installations" ADD CONSTRAINT "tyre_installations_service_record_id_workspace_id_fkey" FOREIGN KEY ("service_record_id", "workspace_id") REFERENCES "service_records"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tyre_installations" ADD CONSTRAINT "tyre_installations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

