-- CreateEnum
CREATE TYPE "QuantityUnit" AS ENUM ('LITRES', 'US_GALLONS', 'IMP_GALLONS', 'KWH');

-- CreateTable
CREATE TABLE "fuel_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "workspace_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "filled_on" DATE NOT NULL,
    "odometer" INTEGER NOT NULL,
    "odometer_unit" "DistanceUnit" NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "quantity_unit" "QuantityUnit" NOT NULL,
    "total_amount" DECIMAL(14,2),
    "unit_price" DECIMAL(10,4),
    "currency" CHAR(3) NOT NULL DEFAULT 'GBP',
    "fuel_type" "FuelType",
    "is_full_tank" BOOLEAN NOT NULL DEFAULT true,
    "is_partial_fill" BOOLEAN NOT NULL DEFAULT false,
    "missed_fill" BOOLEAN NOT NULL DEFAULT false,
    "station_name" TEXT,
    "contact_id" UUID,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuel_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fuel_entries_workspace_id_vehicle_id_filled_on_idx" ON "fuel_entries"("workspace_id", "vehicle_id", "filled_on" DESC);

-- CreateIndex
CREATE INDEX "fuel_entries_workspace_id_vehicle_id_odometer_idx" ON "fuel_entries"("workspace_id", "vehicle_id", "odometer");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_entries_id_workspace_uk" ON "fuel_entries"("id", "workspace_id");

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_vehicle_id_workspace_id_fkey" FOREIGN KEY ("vehicle_id", "workspace_id") REFERENCES "vehicles"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_entries" ADD CONSTRAINT "fuel_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
