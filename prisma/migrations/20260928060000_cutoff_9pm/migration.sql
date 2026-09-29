-- Same-day payouts: deliveries confirmed before 21:00 Lagos, paid at 22:00.
ALTER TABLE "PayoutConfig" ALTER COLUMN "cutoffHourLagos" SET DEFAULT 21;
ALTER TABLE "PayoutConfig" ALTER COLUMN "runHourLagos" SET DEFAULT 22;

UPDATE "PayoutConfig"
SET "cutoffHourLagos" = 21,
    "runHourLagos" = CASE WHEN "runHourLagos" <= 21 THEN 22 ELSE "runHourLagos" END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default';
