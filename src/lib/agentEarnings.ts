import { AppError } from "@/lib/errors";
import { getAgentPayConfig } from "@/lib/agentPay";
import { prisma } from "@/lib/prisma";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** West Africa Time, no daylight saving. Month bounds follow the Lagos calendar. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export type EarningsLine = {
  key: "base" | "transport" | "activation" | "volume" | "retention";
  label: string;
  amountKobo: number;
  status: "due" | "pending";
  /** What the agent has to do to earn this line. */
  task: string;
  /** Unit rate in kobo. Null when the amount shown is already the monthly rate. */
  rateKobo: number | null;
  /** Words after the unit rate, such as "per rider". */
  rateLabel: string | null;
  detail: string;
};

export type AgentEarnings = {
  month: string;
  lines: EarningsLine[];
  totalKobo: number;
  activatedCount: number;
  cohortCount: number;
  payout: { amountKobo: number; reference: string; paidAt: string } | null;
};

export function parseEarningsMonth(month: string): { month: string; start: Date; end: Date } {
  if (!MONTH.test(month)) {
    throw new AppError("Month must be YYYY-MM", "VALIDATION_ERROR", 400);
  }
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1) - LAGOS_OFFSET_MS);
  const end = new Date(Date.UTC(year, mon, 1) - LAGOS_OFFSET_MS);
  return { month, start, end };
}

export function currentEarningsMonth(now = new Date()): string {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const month = String(lagos.getUTCMonth() + 1).padStart(2, "0");
  return `${lagos.getUTCFullYear()}-${month}`;
}

export type EarningsRider = {
  id: string;
  approvedAt: Date | null;
  firstTenReachedAt: Date | null;
  /** Completed-order timestamps. Retention checks the window before each rider's own 30-day mark. */
  completedAt: Date[];
};

export type AgentPaySlice = {
  activationPay: number;
  volumeBonusPer10: number;
  retentionBonus: number;
  retentionThreshold: number;
  activityWindowDays: number;
  baseStipend: number;
  transportAllowance: number;
};

function naira(kobo: number): string {
  return `₦${Math.trunc(kobo / 100).toLocaleString("en-US")}`;
}

function riderWasActive(completedAt: Date[], evalAt: Date, windowDays: number): boolean {
  const start = evalAt.getTime() - windowDays * DAY_MS;
  const end = evalAt.getTime();
  return completedAt.some((at) => {
    const time = at.getTime();
    return time >= start && time < end;
  });
}

/** Stipend and transport are guaranteed. Activation is per rider who hits 10 deliveries. */
export function quoteAgentEarnings(input: {
  range: { start: Date; end: Date };
  now: Date;
  rates: AgentPaySlice;
  riders: EarningsRider[];
}): Pick<AgentEarnings, "lines" | "totalKobo" | "activatedCount" | "cohortCount"> {
  const { range, now, rates, riders } = input;
  const activated = riders.filter(
    (rider) =>
      rider.firstTenReachedAt != null &&
      rider.firstTenReachedAt >= range.start &&
      rider.firstTenReachedAt < range.end,
  );
  const cohort = riders.filter(
    (rider) => rider.approvedAt != null && rider.approvedAt >= range.start && rider.approvedAt < range.end,
  );

  const activationAmount = activated.length * rates.activationPay;
  const volumeBlocks = Math.floor(activated.length / 10);
  const volumeAmount = volumeBlocks * rates.volumeBonusPer10;

  let retentionStatus: "due" | "pending" = "pending";
  let retentionAmount = 0;
  let retentionDetail = "Waiting until 30 days after each rider's approval.";
  const retentionNeed = Math.round(rates.retentionThreshold * 100);
  if (cohort.length === 0) {
    retentionStatus = "due";
    retentionDetail = "No riders were approved this month.";
  } else {
    const evalAts = cohort.map((rider) => new Date(rider.approvedAt!.getTime() + 30 * DAY_MS));
    const readyAt = new Date(Math.max(...evalAts.map((at) => at.getTime())));
    if (now.getTime() < readyAt.getTime()) {
      retentionDetail = `Pending until ${readyAt.toISOString().slice(0, 10)}, 30 days after the last approval. ${cohort.length} rider${cohort.length === 1 ? "" : "s"} in this month's cohort.`;
    } else {
      retentionStatus = "due";
      const stillActive = cohort.filter((rider, index) =>
        riderWasActive(rider.completedAt, evalAts[index], rates.activityWindowDays),
      ).length;
      const share = stillActive / cohort.length;
      const pct = Math.round(share * 100);
      if (share + 1e-9 >= rates.retentionThreshold) retentionAmount = rates.retentionBonus;
      retentionDetail = `${stillActive} of ${cohort.length} still delivering 30 days after approval (${pct}%, need ${retentionNeed}%).`;
    }
  }

  const lines: EarningsLine[] = [
    {
      key: "base",
      label: "Base stipend",
      amountKobo: rates.baseStipend,
      status: "due",
      task: "Paid monthly, guaranteed.",
      rateKobo: null,
      rateLabel: null,
      detail: "",
    },
    {
      key: "transport",
      label: "Transport allowance",
      amountKobo: rates.transportAllowance,
      status: "due",
      task: "Paid monthly, guaranteed.",
      rateKobo: null,
      rateLabel: null,
      detail: "",
    },
    {
      key: "activation",
      label: "Activation pay",
      amountKobo: activationAmount,
      status: "due",
      task: "",
      rateKobo: rates.activationPay,
      rateLabel: "per rider",
      detail: `${activated.length} rider${activated.length === 1 ? "" : "s"} reached 10 deliveries this month → ${naira(activationAmount)}`,
    },
    {
      key: "volume",
      label: "Volume bonus",
      amountKobo: volumeAmount,
      status: "due",
      task: "Extra pay on top of activation, for every 10 riders who reach 10 deliveries.",
      rateKobo: rates.volumeBonusPer10,
      rateLabel: "per 10 riders",
      detail:
        volumeBlocks > 0
          ? `${volumeBlocks} block${volumeBlocks === 1 ? "" : "s"} of 10 activated riders → ${naira(volumeAmount)}`
          : `${activated.length} activated. A bonus starts at 10.`,
    },
    {
      key: "retention",
      label: "Retention bonus",
      amountKobo: retentionAmount,
      status: retentionStatus,
      task: `Once for the month if ${retentionNeed}% are still delivering 30 days after approval.`,
      rateKobo: rates.retentionBonus,
      rateLabel: "for the month",
      detail: retentionDetail,
    },
  ];

  const totalKobo = lines.reduce((sum, line) => sum + (line.status === "due" ? line.amountKobo : 0), 0);
  return { lines, totalKobo, activatedCount: activated.length, cohortCount: cohort.length };
}

export async function computeAgentEarnings(agentId: string, month: string, now = new Date()): Promise<AgentEarnings> {
  const range = parseEarningsMonth(month);
  const rates = await getAgentPayConfig();

  const attributed = await prisma.rider.findMany({
    where: { onboardedByAgentId: agentId },
    select: {
      id: true,
      approvedAt: true,
      firstTenReachedAt: true,
    },
  });
  const cohortIds = attributed
    .filter((rider) => rider.approvedAt && rider.approvedAt >= range.start && rider.approvedAt < range.end)
    .map((rider) => rider.id);
  const deliveries = cohortIds.length
    ? await prisma.order.findMany({
        where: { riderId: { in: cohortIds }, status: "completed", completedAt: { not: null } },
        select: { riderId: true, completedAt: true },
      })
    : [];
  const completedByRider = new Map<string, Date[]>();
  for (const row of deliveries) {
    if (!row.riderId || !row.completedAt) continue;
    const list = completedByRider.get(row.riderId) ?? [];
    list.push(row.completedAt);
    completedByRider.set(row.riderId, list);
  }

  const quoted = quoteAgentEarnings({
    range,
    now,
    rates,
    riders: attributed.map((rider) => ({
      id: rider.id,
      approvedAt: rider.approvedAt,
      firstTenReachedAt: rider.firstTenReachedAt,
      completedAt: completedByRider.get(rider.id) ?? [],
    })),
  });

  const payout = await prisma.agentPayout.findUnique({
    where: { agentId_month: { agentId, month: range.month } },
  });

  return {
    month: range.month,
    lines: quoted.lines,
    totalKobo: quoted.totalKobo,
    activatedCount: quoted.activatedCount,
    cohortCount: quoted.cohortCount,
    payout: payout
      ? {
          amountKobo: payout.amount,
          reference: payout.reference,
          paidAt: payout.createdAt.toISOString(),
        }
      : null,
  };
}
