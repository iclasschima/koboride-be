-- CreateEnum
CREATE TYPE "RiderIdType" AS ENUM ('nin', 'drivers_license', 'voters_card', 'passport');

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN "idType" "RiderIdType",
ADD COLUMN "idNumber" TEXT,
ADD COLUMN "idDocumentUrl" TEXT,
ADD COLUMN "nextOfKinName" TEXT,
ADD COLUMN "nextOfKinPhone" TEXT,
ADD COLUMN "nextOfKinRelationship" TEXT;
