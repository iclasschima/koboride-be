-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super', 'staff');

-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('orders', 'users', 'shops', 'riders', 'agents', 'payouts', 'payments', 'settings');

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "permissions" "AdminPermission"[],
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "role" "AdminRole" NOT NULL DEFAULT 'super';

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amountNgn" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "orderId" TEXT,
    "paystackRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Refund_reference_idx" ON "Refund"("reference");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
