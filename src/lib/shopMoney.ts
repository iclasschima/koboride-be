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
