-- AlterTable
ALTER TABLE "Order" ADD COLUMN "completedAt" TIMESTAMP(3);

-- Backfill existing completed orders from last status change.
UPDATE "Order"
SET "completedAt" = "updatedAt"
WHERE "status" = 'completed' AND "completedAt" IS NULL;
