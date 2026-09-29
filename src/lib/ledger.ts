import type { PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nairaToKobo } from "@/lib/paystack";

type LedgerClient = Prisma.TransactionClient | typeof prisma;

export type CompletedOrderLedger = {
  id: string;
  riderId: string | null;
  paymentMethod: PaymentMethod;
  feeNgn: number;
  payoutNgn: number;
  status: string;
};

function isUnique(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

async function insertEntry(
  db: LedgerClient,
  input: {
    riderId: string;
    orderId?: string | null;
    type: string;
    amount: number;
    idempotencyKey: string;
    payoutId?: string | null;
    note?: string | null;
    createdBy: string;
  },
): Promise<void> {
  try {
    await db.ledgerEntry.create({ data: input });
  } catch (err) {
    if (isUnique(err)) return;
    throw err;
  }
}

/** Online credit or cash commission. A repeated confirm hits the unique key and stops. */
export async function writeConfirmedLedger(db: LedgerClient, order: CompletedOrderLedger): Promise<void> {
  if (order.status !== "completed" || !order.riderId) return;
  if (order.paymentMethod === "paystack") {
    const amount = nairaToKobo(order.payoutNgn);
    if (amount <= 0) return;
    await insertEntry(db, {
      riderId: order.riderId,
      orderId: order.id,
      type: "ONLINE_EARNING",
      amount,
      idempotencyKey: `order:${order.id}:online`,
      createdBy: "system",
    });
    return;
  }
  const gap = order.payoutNgn - order.feeNgn;
  if (gap > 0) {
    await insertEntry(db, {
      riderId: order.riderId,
      orderId: order.id,
      type: "ONLINE_EARNING",
      amount: nairaToKobo(gap),
      idempotencyKey: `order:${order.id}:discount`,
      note: "Location discount covered by KoboRide",
      createdBy: "system",
    });
    return;
  }
  const commission = nairaToKobo(Math.max(0, order.feeNgn - order.payoutNgn));
  if (commission <= 0) return;
  await insertEntry(db, {
    riderId: order.riderId,
    orderId: order.id,
    type: "CASH_COMMISSION",
    amount: -commission,
    idempotencyKey: `order:${order.id}:cash`,
    createdBy: "system",
  });
}

export async function writeConfirmedLedgerNow(order: CompletedOrderLedger): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await writeConfirmedLedger(tx, order);
  });
}

export async function cashDebtKobo(riderId: string): Promise<number> {
  const rows = await prisma.ledgerEntry.findMany({
    where: {
      riderId,
      payoutId: null,
      type: { in: ["CASH_COMMISSION", "CLAWBACK", "ADJUSTMENT"] },
      amount: { lt: 0 },
    },
    select: { amount: true },
  });
  return rows.reduce((sum, row) => sum + Math.abs(row.amount), 0);
}
