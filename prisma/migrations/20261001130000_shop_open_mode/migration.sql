-- CreateEnum
CREATE TYPE "ShopOpenMode" AS ENUM ('hours', 'open', 'closed');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "openMode" "ShopOpenMode" NOT NULL DEFAULT 'hours';
