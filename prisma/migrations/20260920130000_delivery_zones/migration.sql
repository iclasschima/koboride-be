-- AlterTable
ALTER TABLE "Rider" ADD COLUMN "zoneSlug" TEXT NOT NULL DEFAULT 'YAB';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "zoneSlug" TEXT NOT NULL DEFAULT 'YAB';

-- CreateIndex
CREATE INDEX "Rider_zoneSlug_idx" ON "Rider"("zoneSlug");

-- CreateIndex
CREATE INDEX "Order_zoneSlug_status_scheduledFor_idx" ON "Order"("zoneSlug", "status", "scheduledFor");
