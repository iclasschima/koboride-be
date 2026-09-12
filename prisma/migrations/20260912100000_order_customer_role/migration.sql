-- CreateEnum
CREATE TYPE "CustomerRole" AS ENUM ('sender', 'receiver');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "customerRole" "CustomerRole" NOT NULL DEFAULT 'sender';
