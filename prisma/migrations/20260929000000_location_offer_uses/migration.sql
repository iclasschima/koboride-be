ALTER TABLE "LocationOffer" ADD COLUMN "maxUsesPerCustomer" INTEGER;

ALTER TABLE "Order" ADD COLUMN "pickupOfferId" TEXT;
ALTER TABLE "Order" ADD COLUMN "dropoffOfferId" TEXT;

CREATE INDEX "Order_pickupOfferId_idx" ON "Order"("pickupOfferId");
CREATE INDEX "Order_dropoffOfferId_idx" ON "Order"("dropoffOfferId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupOfferId_fkey" FOREIGN KEY ("pickupOfferId") REFERENCES "LocationOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_dropoffOfferId_fkey" FOREIGN KEY ("dropoffOfferId") REFERENCES "LocationOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
