-- AlterTable
ALTER TABLE "Order" ADD COLUMN "deliveryPin" TEXT NOT NULL DEFAULT '0000';
ALTER TABLE "Order" ADD COLUMN "deliveryProof" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryProofNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryProofPhotoUrl" TEXT;

UPDATE "Order"
SET "deliveryPin" = LPAD(FLOOR(RANDOM() * 10000)::int::text, 4, '0')
WHERE "deliveryPin" = '0000';

ALTER TABLE "Order" ALTER COLUMN "deliveryPin" DROP DEFAULT;
