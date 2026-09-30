-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN "bankName" TEXT,
ADD COLUMN "bankCode" TEXT,
ADD COLUMN "bankAccountNo" TEXT,
ADD COLUMN "bankAccountName" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "shopPaidOutAt" TIMESTAMP(3);
