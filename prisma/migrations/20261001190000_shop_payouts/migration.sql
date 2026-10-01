-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "paystackRecipientCode" TEXT;

-- CreateTable
CREATE TABLE "ShopPayout" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "amountNgn" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paystackTransferCode" TEXT,
    "failureReason" TEXT,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopPayout_reference_key" ON "ShopPayout"("reference");

-- CreateIndex
CREATE INDEX "ShopPayout_merchantId_createdAt_idx" ON "ShopPayout"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopPayout" ADD CONSTRAINT "ShopPayout_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopPayout" ADD CONSTRAINT "ShopPayout_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
