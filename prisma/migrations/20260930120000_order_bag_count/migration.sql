-- How many bags one delivery contains
ALTER TABLE "Order" ADD COLUMN "bagCount" INTEGER NOT NULL DEFAULT 1;
