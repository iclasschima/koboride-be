/** Pure payout rules. Amounts are integer kobo. */

export const LEDGER_TYPES = [
  "ONLINE_EARNING",
  "CASH_COMMISSION",
  "RECOVERY",
  "PAYOUT",
  "PAYOUT_REVERSAL",
  "CLAWBACK",
  "ADJUSTMENT",
] as const;

export type LedgerType = (typeof LEDGER_TYPES)[number];

export type OpenEntry = {
  id: string;
  type: LedgerType;
  amount: number;
  createdAt: string;
};

export type PayoutPlan = {
  gross: number;
  owed: number;
  recovery: number;
  net: number;
  decision: "pay" | "skip";
  /** Entries whose payoutId should be set. */
  consumeIds: string[];
  /** Unpaid remainder when a debt entry is only partly recovered. */
  debtRemainder: { sourceId: string; amount: number } | null;
};

const CREDIT_TYPES = new Set<LedgerType>(["ONLINE_EARNING", "PAYOUT_REVERSAL"]);

export function planRiderPayout(
  entries: OpenEntry[],
  config: { minPayout: number; recoveryCapRatio: number },
): PayoutPlan {
  const credits = entries.filter((entry) => CREDIT_TYPES.has(entry.type) || (entry.type === "ADJUSTMENT" && entry.amount > 0));
  const debts = entries.filter(
    (entry) =>
      entry.type === "CASH_COMMISSION" ||
      entry.type === "CLAWBACK" ||
      (entry.type === "ADJUSTMENT" && entry.amount < 0),
  );
  const gross = credits.reduce((sum, entry) => sum + entry.amount, 0);
  const owed = debts.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const cap = Math.min(1, Math.max(0, config.recoveryCapRatio));
  const recoveryRoom = Math.min(owed, Math.floor(gross * cap));
  const net = gross - recoveryRoom;
  if (gross <= 0 || net < config.minPayout) {
    return { gross, owed, recovery: 0, net: 0, decision: "skip", consumeIds: [], debtRemainder: null };
  }

  const consumeIds = credits.map((entry) => entry.id);
  let left = recoveryRoom;
  let debtRemainder: PayoutPlan["debtRemainder"] = null;
  const ordered = [...debts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const debt of ordered) {
    if (left <= 0) break;
    const size = Math.abs(debt.amount);
    if (size <= left) {
      consumeIds.push(debt.id);
      left -= size;
      continue;
    }
    consumeIds.push(debt.id);
    debtRemainder = { sourceId: debt.id, amount: -(size - left) };
    left = 0;
  }
  const recovery = recoveryRoom - left;
  return {
    gross,
    owed,
    recovery,
    net: gross - recovery,
    decision: "pay",
    consumeIds,
    debtRemainder,
  };
}

export function payoutReference(riderId: string, runDate: string): string {
  const raw = `payout-${riderId}-${runDate}`.toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]/g, "");
  if (!/^[a-z0-9_-]+$/.test(cleaned) || cleaned.length > 100) {
    throw new Error("Transfer reference is not valid for Paystack");
  }
  return cleaned;
}

/** Oldest plans are paid first. Plans that do not fit stay unpaid. */
export function allocateBalance<T extends { net: number; oldestAt: string; riderId: string }>(
  plans: T[],
  balanceKobo: number,
): { funded: T[]; held: T[]; shortfall: number } {
  const ordered = [...plans].sort(
    (a, b) => a.oldestAt.localeCompare(b.oldestAt) || a.riderId.localeCompare(b.riderId),
  );
  const funded: T[] = [];
  const held: T[] = [];
  let left = Math.max(0, Math.trunc(balanceKobo));
  for (const plan of ordered) {
    if (plan.net <= left) {
      funded.push(plan);
      left -= plan.net;
    } else {
      held.push(plan);
    }
  }
  const shortfall = held.reduce((sum, plan) => sum + plan.net, 0);
  return { funded, held, shortfall };
}

const TERMINAL = new Set(["SUCCESS", "FAILED", "REVERSED", "SKIPPED"]);

export function applyTransferEvent(
  status: string,
  event: "transfer.success" | "transfer.failed" | "transfer.reversed",
): { status: string; restore: boolean } | null {
  if (TERMINAL.has(status)) return null;
  if (event === "transfer.success") return { status: "SUCCESS", restore: false };
  if (event === "transfer.reversed") return { status: "REVERSED", restore: true };
  return { status: "FAILED", restore: true };
}

export function badAccountReason(reason: string): boolean {
  return /account|recipient|name mismatch|dormant|closed|invalid nuban|could not resolve/i.test(reason);
}

/** Case-insensitive, ignores order, and allows a middle name on either side. */
export function namesPlausiblyMatch(riderName: string, accountName: string): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);
  const rider = words(riderName);
  const bank = new Set(words(accountName));
  if (rider.length === 0 || bank.size === 0) return false;
  const matched = rider.filter((word) => bank.has(word));
  if (rider.length === 1) return matched.length === 1;
  return matched.length >= 2 || matched.length === rider.length;
}

const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export function lagosParts(at: Date): { date: string; hour: number; minute: number } {
  const shifted = new Date(at.getTime() + LAGOS_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return {
    date: `${year}-${month}-${day}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** cutoffHour on runDate in Africa/Lagos, as a UTC instant. */
export function lagosCutoff(runDate: string, cutoffHour: number): Date {
  const [year, month, day] = runDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, cutoffHour, 0, 0) - LAGOS_OFFSET_MS);
}

export function confirmedBeforeCutoff(confirmedAt: Date, cutoffAt: Date): boolean {
  return confirmedAt.getTime() < cutoffAt.getTime();
}
