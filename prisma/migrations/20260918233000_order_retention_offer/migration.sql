-- AlterTable
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "retentionOfferShown" BOOLEAN NOT NULL DEFAULT false;
