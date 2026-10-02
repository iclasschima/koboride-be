import type { CustomerRole, PaymentMethod, PaymentStatus } from "@prisma/client";

type CardOrder = {
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  goodsNgn: number;
  feeNgn: number;
  farePayer: CustomerRole;
};

export function shopCardPaid(order: Pick<CardOrder, "paymentMethod" | "paymentStatus">): boolean {
  return order.paymentMethod === "paystack" && order.paymentStatus === "paid";
}

/** Card orders charge items plus delivery. When the shop pays delivery, the card covers items only. */
export function shopCardTotalNgn(goodsNgn: number, feeNgn: number, farePayer: CustomerRole): number {
  return goodsNgn + (farePayer === "receiver" ? feeNgn : 0);
}

/** What KoboRide owes the shop for a delivered card order. Shop-paid delivery comes out of it. */
export function shopPayoutNgn(order: Pick<CardOrder, "goodsNgn" | "feeNgn" | "farePayer">): number {
  return order.goodsNgn - (order.farePayer === "sender" ? order.feeNgn : 0);
}

type LedgerOrder = { id: string; amountNgn: number; markedPaidAt: Date | null };
type LedgerPayout = { amountNgn: number; createdAt: Date };

/**
 * What a shop is owed: delivered card orders' shares minus payouts. Payouts cover open orders oldest first,
 * so an order counts as paid once the payouts up to some date add up to it. Orders must be oldest first.
 */
export function shopBalance(orders: LedgerOrder[], payouts: LedgerPayout[]) {
  const paidAt = new Map<string, Date>();
  const open: LedgerOrder[] = [];
  let earnedNgn = 0;
  let paidOutNgn = 0;
  for (const order of orders) {
    earnedNgn += order.amountNgn;
    if (order.markedPaidAt) {
      paidOutNgn += order.amountNgn;
      paidAt.set(order.id, order.markedPaidAt);
    } else {
      open.push(order);
    }
  }
  let pool = 0;
  let next = 0;
  for (const payout of payouts) {
    paidOutNgn += payout.amountNgn;
    pool += payout.amountNgn;
    while (next < open.length && pool >= open[next].amountNgn) {
      pool -= open[next].amountNgn;
      paidAt.set(open[next].id, payout.createdAt);
      next += 1;
    }
  }
  return {
    owedNgn: Math.max(0, earnedNgn - paidOutNgn),
    owedOrders: open.length - next,
    paidOutNgn,
    paidAt,
  };
}
