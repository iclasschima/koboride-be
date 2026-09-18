-- AlterTable
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'paystack');
CREATE TYPE "PaymentStatus" AS ENUM ('unpaid', 'paid');

ALTER TABLE "Order" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'cash';
ALTER TABLE "Order" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'unpaid';
ALTER TABLE "Order" ADD COLUMN "paystackReference" TEXT;
ALTER TABLE "Order" ADD COLUMN "paidAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_paystackReference_key" ON "Order"("paystackReference");
