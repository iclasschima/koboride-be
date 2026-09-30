CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Merchant_phone_key" ON "Merchant"("phone");
CREATE UNIQUE INDEX "Merchant_slug_key" ON "Merchant"("slug");

CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceNgn" INTEGER NOT NULL,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MenuItem_merchantId_available_idx" ON "MenuItem"("merchantId", "available");

ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "merchantId" TEXT,
ADD COLUMN "goodsNgn" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "readyAt" TIMESTAMP(3),
ADD COLUMN "goodsSettledAt" TIMESTAMP(3);

CREATE INDEX "Order_merchantId_createdAt_idx" ON "Order"("merchantId", "createdAt");

ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceNgn" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
