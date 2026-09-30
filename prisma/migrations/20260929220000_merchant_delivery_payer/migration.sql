-- Riders no longer collect item money for shops; only delivery is paid through the rider.
ALTER TABLE "Order" DROP COLUMN "goodsSettledAt";

ALTER TABLE "Merchant" ADD COLUMN "deliveryPayer" "CustomerRole" NOT NULL DEFAULT 'receiver';
