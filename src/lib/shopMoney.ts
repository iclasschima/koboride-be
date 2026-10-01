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

/**
 * Paystack's local fee is 1.5% + ₦100, with the ₦100 waived under ₦2,500 and the fee capped at ₦2,000.
 * Returns what to add to `netNgn` so that, after Paystack takes its fee, `netNgn` is left.
 */
export function paystackFeeNgn(netNgn: number): number {
  if (netNgn <= 0) return 0;
  const small = Math.ceil((netNgn * 1000) / 985);
  if (small < 2500) return small - netNgn;
  return Math.min(Math.ceil(((netNgn + 100) * 1000) / 985) - netNgn, 2000);
}

/** What KoboRide owes the shop for a delivered card order. Shop-paid delivery comes out of it. */
export function shopPayoutNgn(order: Pick<CardOrder, "goodsNgn" | "feeNgn" | "farePayer">): number {
  return order.goodsNgn - (order.farePayer === "sender" ? order.feeNgn : 0);
}
