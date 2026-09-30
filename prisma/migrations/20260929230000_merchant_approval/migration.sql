-- New shops wait for an admin before they can send bags or take link orders.
ALTER TABLE "Merchant" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Shops that already exist keep working.
UPDATE "Merchant" SET "approvedAt" = CURRENT_TIMESTAMP;
