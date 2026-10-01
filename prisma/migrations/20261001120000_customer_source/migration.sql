-- CreateEnum
CREATE TYPE "CustomerSource" AS ENUM ('app', 'shop_link', 'shop_bag', 'admin');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "source" "CustomerSource",
ADD COLUMN     "sourceLanding" TEXT,
ADD COLUMN     "sourceMerchantId" TEXT,
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "sourceReferrer" TEXT;

-- CreateIndex
CREATE INDEX "Customer_sourceMerchantId_idx" ON "Customer"("sourceMerchantId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_sourceMerchantId_fkey" FOREIGN KEY ("sourceMerchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from each customer's first order. Only shop orders say where the customer came from:
-- menu-link orders are held for the shop (shop_order_held); bags a shop sends are not.
WITH first_order AS (
  SELECT DISTINCT ON ("customerId") "id", "customerId", "merchantId"
  FROM "Order"
  ORDER BY "customerId", "createdAt" ASC
)
UPDATE "Customer" AS c
SET "source" = CASE
      WHEN EXISTS (
        SELECT 1 FROM "OrderEvent" AS e WHERE e."orderId" = f."id" AND e."type" = 'shop_order_held'
      ) THEN 'shop_link'::"CustomerSource"
      ELSE 'shop_bag'::"CustomerSource"
    END,
    "sourceMerchantId" = f."merchantId"
FROM first_order AS f
WHERE f."customerId" = c."id" AND f."merchantId" IS NOT NULL;
