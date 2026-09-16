-- CreateTable
CREATE TABLE "OrderRelease" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "phase" "RiderPhase",
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderRelease_orderId_idx" ON "OrderRelease"("orderId");

-- CreateIndex
CREATE INDEX "OrderRelease_riderId_createdAt_idx" ON "OrderRelease"("riderId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderRelease" ADD CONSTRAINT "OrderRelease_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRelease" ADD CONSTRAINT "OrderRelease_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
