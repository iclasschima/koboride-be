-- AlterTable
ALTER TABLE "Order" ADD COLUMN "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill existing orders with great-circle distance from stored coords.
UPDATE "Order"
SET "distanceKm" = ROUND(
  (
    6371 * 2 * ASIN(
      SQRT(
        POWER(SIN(RADIANS("dropoffLat" - "pickupLat") / 2), 2) +
        COS(RADIANS("pickupLat")) * COS(RADIANS("dropoffLat")) *
        POWER(SIN(RADIANS("dropoffLng" - "pickupLng") / 2), 2)
      )
    )
  )::numeric,
  3
)
WHERE "pickupLat" IS NOT NULL
  AND "dropoffLat" IS NOT NULL;
