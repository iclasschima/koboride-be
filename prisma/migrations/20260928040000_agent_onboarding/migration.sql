-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('SUBMITTED', 'ID_VERIFIED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentPayConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "activationPay" INTEGER NOT NULL DEFAULT 250000,
    "volumeBonusPer10" INTEGER NOT NULL DEFAULT 500000,
    "retentionBonus" INTEGER NOT NULL DEFAULT 1000000,
    "retentionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "activityWindowDays" INTEGER NOT NULL DEFAULT 14,
    "baseStipend" INTEGER NOT NULL DEFAULT 3000000,
    "transportAllowance" INTEGER NOT NULL DEFAULT 1000000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPayConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentPayout" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingEvent" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN "onboardedByAgentId" TEXT;
ALTER TABLE "Rider" ADD COLUMN "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'SUBMITTED';
ALTER TABLE "Rider" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "Rider" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Rider" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Rider" ADD COLUMN "firstTenReachedAt" TIMESTAMP(3);
ALTER TABLE "Rider" ADD COLUMN "idVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Rider" ADD COLUMN "bankName" TEXT;
ALTER TABLE "Rider" ADD COLUMN "bankAccountNo" TEXT;
ALTER TABLE "Rider" ADD COLUMN "idNumberLookup" TEXT;
ALTER TABLE "Rider" ADD COLUMN "photoWithBikeUrl" TEXT;
ALTER TABLE "Rider" ADD COLUMN "selfieUrl" TEXT;
ALTER TABLE "Rider" ADD COLUMN "depositPaid" BOOLEAN NOT NULL DEFAULT false;

-- Existing riders are not agent submissions. Approved ones stay approved.
UPDATE "Rider"
SET "onboardingStatus" = 'APPROVED',
    "approvedAt" = "createdAt"
WHERE "approved" = true;

-- CreateIndex
CREATE UNIQUE INDEX "Agent_phone_key" ON "Agent"("phone");
CREATE UNIQUE INDEX "AgentPayout_agentId_month_key" ON "AgentPayout"("agentId", "month");
CREATE INDEX "AgentPayout_agentId_idx" ON "AgentPayout"("agentId");
CREATE INDEX "OnboardingEvent_riderId_createdAt_idx" ON "OnboardingEvent"("riderId", "createdAt");
CREATE UNIQUE INDEX "Rider_idNumberLookup_key" ON "Rider"("idNumberLookup");
CREATE INDEX "Rider_onboardedByAgentId_idx" ON "Rider"("onboardedByAgentId");
CREATE INDEX "Rider_onboardingStatus_submittedAt_idx" ON "Rider"("onboardingStatus", "submittedAt");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_onboardedByAgentId_fkey" FOREIGN KEY ("onboardedByAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentPayout" ADD CONSTRAINT "AgentPayout_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingEvent" ADD CONSTRAINT "OnboardingEvent_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AgentPayConfig" (
    "id",
    "activationPay",
    "volumeBonusPer10",
    "retentionBonus",
    "retentionThreshold",
    "activityWindowDays",
    "baseStipend",
    "transportAllowance",
    "updatedAt"
) VALUES (
    'default',
    250000,
    500000,
    1000000,
    0.7,
    14,
    3000000,
    1000000,
    CURRENT_TIMESTAMP
);
