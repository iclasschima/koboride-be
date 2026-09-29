import { api, json, options } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lagosCutoff, lagosParts } from "@/lib/payoutMath";

export const OPTIONS = () => options();

const LABEL: Record<string, string> = {
  ONLINE_EARNING: "Delivery",
  CASH_COMMISSION: "Cash commission owed",
  RECOVERY: "Cash commission recovered",
  PAYOUT: "Payout",
  PAYOUT_REVERSAL: "Payout returned",
  CLAWBACK: "Refund clawback",
  ADJUSTMENT: "Adjustment",
};

export const GET = api(async (req) => {
  const { rider } = await requireRider(req);
  const config = await prisma.payoutConfig.findUnique({ where: { id: "default" } });
  const cutoffHour = config?.cutoffHourLagos ?? 21;
  const runHour = config?.runHourLagos ?? 22;
  const today = lagosParts(new Date());
  const cutoffAt = lagosCutoff(today.date, cutoffHour);
  const entries = await prisma.ledgerEntry.findMany({
    where: { riderId: rider.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const open = entries.filter((entry) => !entry.payoutId);
  const dueToday = open
    .filter((entry) => entry.createdAt < cutoffAt && entry.amount > 0)
    .reduce((sum, entry) => sum + entry.amount, 0);
  let blockedReason: string | null = null;
  if (!rider.bankVerifiedAt) {
    blockedReason = "Add a bank account that matches your name. Earnings are saved until then.";
  } else if (rider.bankNeedsReview) {
    blockedReason = "Your bank account needs a review from KoboRide before it can be paid.";
  }
  return json({
    dueTodayKobo: dueToday,
    cutoffHour,
    runHour,
    blockedReason,
    lines: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      label: entry.type === "RECOVERY" ? "Cash commission recovered" : (LABEL[entry.type] ?? entry.type),
      amountKobo: entry.amount,
      note: entry.note,
      status: entry.payoutId ? "included" : "open",
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});
