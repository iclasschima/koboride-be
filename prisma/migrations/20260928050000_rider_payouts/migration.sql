-- AlterTable
ALTER TABLE "Rider" ADD COLUMN "bankCode" TEXT,
ADD COLUMN "bankAccountName" TEXT,
ADD COLUMN "bankVerifiedAt" TIMESTAMP(3),
ADD COLUMN "paystackRecipientCode" TEXT,
ADD COLUMN "bankNeedsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payoutId" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRun" (
    "id" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,

    CONSTRAINT "PayoutRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "grossEarnings" INTEGER NOT NULL,
    "recovered" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paystackTransferCode" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "cutoffHourLagos" INTEGER NOT NULL DEFAULT 18,
    "runHourLagos" INTEGER NOT NULL DEFAULT 20,
    "minPayout" INTEGER NOT NULL DEFAULT 50000,
    "recoveryCapRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "cashDebtBlockLimit" INTEGER NOT NULL DEFAULT 200000,
    "refundCostBearer" TEXT NOT NULL DEFAULT 'platform',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "LedgerEntry_riderId_createdAt_idx" ON "LedgerEntry"("riderId", "createdAt");
CREATE INDEX "LedgerEntry_payoutId_idx" ON "LedgerEntry"("payoutId");
CREATE UNIQUE INDEX "PayoutRun_runDate_key" ON "PayoutRun"("runDate");
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");
CREATE INDEX "Payout_runId_idx" ON "Payout"("runId");
CREATE INDEX "Payout_riderId_status_idx" ON "Payout"("riderId", "status");
CREATE INDEX "ReconciliationRun_runDate_idx" ON "ReconciliationRun"("runDate");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayoutRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "PayoutConfig" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);
