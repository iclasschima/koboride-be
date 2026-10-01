-- Shop chooses how many different bags one link order can hold.
ALTER TABLE "Merchant" ADD COLUMN "maxBags" INTEGER NOT NULL DEFAULT 1;

-- Each menu line belongs to one bag in the delivery.
ALTER TABLE "OrderLine" ADD COLUMN "bagIndex" INTEGER NOT NULL DEFAULT 1;
