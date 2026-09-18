import { randomInt, timingSafeEqual } from "node:crypto";
import type { CustomerRole, PaymentMethod, PaymentStatus, Prisma, RiderPhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { quoteRoute } from "@/lib/fare";
import { preferredPhone } from "@/lib/phone";
import { getMaxActiveOrders } from "@/lib/settings";
import { nairaToKobo, refundPaystack, verifyPaystack } from "@/lib/paystack";
import {
  notifyAdminNewOrder,
  notifyOrderAccepted,
  notifySearchingRider,
} from "@/lib/push";

export const orderInclude = {
  rider: { select: { id: true, name: true, phone: true, photoUrl: true } },
  customer: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const RIDER_PHASES: RiderPhase[] = [
  "accepted",
  "en_route_pickup",
  "collected",
  "en_route_dropoff",
  "delivered",
];

function isDeliveredAwaitingConfirm(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): boolean {
  return order.status === "in_progress" && order.riderPhase === "delivered";
}

export function orderCompletedData(at = new Date()) {
  return {
    status: "completed" as const,
    riderPhase: "delivered" as const,
    completedAt: at,
  };
}

export function orderDurationSeconds(order: {
  createdAt: Date;
  completedAt: Date | null;
}): number | null {
  if (!order.completedAt) return null;
  return Math.max(0, Math.round((order.completedAt.getTime() - order.createdAt.getTime()) / 1000));
}

/** Close leftover jobs that were marked delivered before PIN completed the order. */
export async function autoConfirmStaleDeliveries(): Promise<void> {
  await prisma.order.updateMany({
    where: {
      status: "in_progress",
      riderPhase: "delivered",
    },
    data: orderCompletedData(),
  });
}

export async function getOrderOrThrow(id: string): Promise<OrderRow> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);
  if (isDeliveredAwaitingConfirm(order)) {
    return prisma.order.update({
      where: { id: order.id },
      data: orderCompletedData(),
      include: orderInclude,
    });
  }
  return order;
}

export function generateDeliveryPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

export function deliveryPinsMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given.replace(/\D/g, "").padStart(4, "0").slice(-4));
  return a.length === b.length && timingSafeEqual(a, b);
}

function toTrip(order: OrderRow, hideDeliveryPin: boolean) {
  return {
    id: order.id,
    pickup: order.pickup,
    dropoff: order.dropoff,
    notes: order.notes ?? "",
    senderName: order.senderName,
    senderPhone: order.senderPhone,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    customerRole: order.customerRole,
    feeNgn: order.feeNgn,
    status: order.status,
    riderPhase: order.riderPhase,
    riderId: order.riderId,
    riderName: order.rider?.name ?? null,
    riderPhone: order.rider?.phone ?? null,
    riderPhotoUrl: order.rider?.photoUrl ?? null,
    customerName: order.customer?.name ?? null,
    customerPhone: order.customer?.phone ?? null,
    payoutNgn: order.payoutNgn,
    payoutPaid: order.payoutPaid,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    distanceKm: order.distanceKm,
    deliveryPin: hideDeliveryPin ? null : order.deliveryPin,
    deliveryPinRevealed: Boolean(order.deliveryPinRevealedAt),
    deliveryPinRequested: Boolean(order.deliveryPinRequestedAt),
    deliveryPinRequestedAt: order.deliveryPinRequestedAt?.toISOString() ?? null,
    requiresDeliveryPin: Boolean(order.deliveryPin),
    deliveryProof: order.deliveryProof,
    deliveryProofNote: order.deliveryProofNote,
    deliveryProofPhotoUrl: order.deliveryProofPhotoUrl,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    durationSeconds: orderDurationSeconds(order),
    autoConfirmInMs: null,
  };
}

export function presentTrip(order: OrderRow) {
  return toTrip(order, false);
}

export function presentRiderTrip(order: OrderRow) {
  return toTrip(order, !order.deliveryPinRevealedAt);
}

export function nextPhase(phase: RiderPhase | null): RiderPhase | null {
  if (!phase) return "accepted";
  if (phase === "en_route_pickup" || phase === "collected") return "en_route_dropoff";
  const i = RIDER_PHASES.indexOf(phase);
  if (i < 0 || i >= RIDER_PHASES.length - 1) return phase;
  return RIDER_PHASES[i + 1]!;
}

export function assertCustomerOwns(
  order: { customerId: string },
  userId: string,
) {
  if (order.customerId !== userId) {
    throw new AppError("This order does not belong to you", "FORBIDDEN", 403);
  }
}

const PICKED_UP: RiderPhase[] = ["collected", "en_route_dropoff", "delivered"];

export function hasPickedUp(order: { riderPhase: RiderPhase | null }): boolean {
  return Boolean(order.riderPhase && PICKED_UP.includes(order.riderPhase));
}

export function customerCanCancel(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): boolean {
  if (order.status === "dispatching") return true;
  if (order.status !== "in_progress") return false;
  return !hasPickedUp(order);
}

/** A rider can hand a job back until the package is in their bag. */
export function riderCanRelease(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): boolean {
  return order.status === "in_progress" && !hasPickedUp(order);
}

export function assertRiderReleaseAllowed(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): void {
  if (!riderCanRelease(order)) {
    throw new AppError(
      "You can only drop a job before you pick up the package",
      "ALREADY_PICKED_UP",
      409,
    );
  }
}

export type ReleaseRow = {
  id: string;
  riderId: string;
  phase: RiderPhase | null;
  reason: string;
  createdAt: Date;
  rider?: { name: string } | null;
};

export function presentRelease(row: ReleaseRow) {
  return {
    id: row.id,
    riderId: row.riderId,
    riderName: row.rider?.name ?? null,
    phase: row.phase,
    reason: row.reason,
    at: row.createdAt.toISOString(),
  };
}

export const RELEASE_REASONS = [
  "Bike problem",
  "Too far from me",
  "Cannot reach the sender",
  "Emergency",
  "Other",
] as const;

export function normalizeReleaseReason(reason: string, note?: string): string {
  const picked = reason.trim();
  if (!(RELEASE_REASONS as readonly string[]).includes(picked)) {
    throw new AppError("Choose why you are dropping this job", "RELEASE_REASON_REQUIRED", 400);
  }
  if (picked !== "Other") return picked;
  const extra = note?.trim() ?? "";
  if (extra.length < 4) {
    throw new AppError("Add a short note for Other", "RELEASE_REASON_REQUIRED", 400);
  }
  return `Other: ${extra.slice(0, 160)}`;
}

export const CANCEL_REASONS = [
  "Ordered by mistake",
  "Wrong pickup or drop-off",
  "Rider taking too long",
  "Changed my mind",
  "Receiver not available",
  "Other",
] as const;

export function normalizeCancelReason(reason: string, note?: string): string {
  const picked = reason.trim();
  if (!(CANCEL_REASONS as readonly string[]).includes(picked)) {
    throw new AppError("Choose why you are cancelling", "CANCEL_REASON_REQUIRED", 400);
  }
  if (picked !== "Other") return picked;
  const extra = note?.trim() ?? "";
  if (extra.length < 4) {
    throw new AppError("Add a short note for Other", "CANCEL_REASON_REQUIRED", 400);
  }
  return `Other: ${extra.slice(0, 160)}`;
}

export function cancelWindowStart(resetAt?: Date | null): Date {
  const windowStart = new Date(Date.now() - config.cancelWindowHours * 60 * 60 * 1000);
  return resetAt && resetAt > windowStart ? resetAt : windowStart;
}

export const ACTIVE_ORDER_STATUSES = ["dispatching", "in_progress"] as const;

export async function countActiveOrders(customerId: string): Promise<number> {
  return prisma.order.count({
    where: { customerId, status: { in: [...ACTIVE_ORDER_STATUSES] } },
  });
}

export async function countRecentCancels(
  customerId: string,
  resetAt?: Date | null,
): Promise<number> {
  return prisma.order.count({
    where: {
      customerId,
      status: "cancelled",
      updatedAt: { gte: cancelWindowStart(resetAt) },
    },
  });
}

export async function assertCustomerCancelAllowed(
  customerId: string,
  order: { status: string; riderPhase: RiderPhase | null },
): Promise<void> {
  if (!customerCanCancel(order)) {
    throw new AppError(
      "You can only cancel before the rider picks up the package",
      "ALREADY_PICKED_UP",
      409,
    );
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { cancelLimitResetAt: true },
  });
  const recent = await countRecentCancels(customerId, customer?.cancelLimitResetAt);
  if (recent >= config.maxCancelsPerWindow) {
    throw new AppError(
      `You've cancelled ${config.maxCancelsPerWindow} orders in the last ${config.cancelWindowHours} hours. Try again later.`,
      "CANCEL_LIMIT_REACHED",
      429,
    );
  }
}

export async function refundIfPaidOnline(order: {
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paystackReference: string | null;
}): Promise<{
  paymentStatus?: PaymentStatus;
  refundedAt?: Date;
  paystackRefundId?: string;
}> {
  if (order.paymentMethod !== "paystack") return {};
  if (order.paymentStatus === "refunded") return {};
  if (order.paymentStatus !== "paid" || !order.paystackReference) return {};

  try {
    const refund = await refundPaystack(order.paystackReference);
    return {
      paymentStatus: "refunded",
      refundedAt: new Date(),
      paystackRefundId: refund.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already|fully refunded/i.test(message)) {
      return { paymentStatus: "refunded", refundedAt: new Date() };
    }
    throw new AppError(
      "Could not refund this payment. Try again in a moment.",
      "REFUND_FAILED",
      502,
    );
  }
}

export type PlaceOrderInput = {
  customerId: string;
  pickup: string;
  dropoff: string;
  notes: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  customerRole?: CustomerRole;
  riderId?: string;
  paymentMethod?: PaymentMethod;
  paystackReference?: string;
};

export function resolveCustomerContacts(input: {
  customerRole?: CustomerRole | string | null;
  customerName: string;
  customerPhone: string;
  senderName?: string;
  senderPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
}): {
  customerRole: CustomerRole;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
} {
  const role: CustomerRole =
    input.customerRole === "receiver" ? "receiver" : "sender";
  const meName = input.customerName.trim() || "Customer";
  const mePhone = preferredPhone(input.customerPhone);

  if (role === "receiver") {
    const senderName = input.senderName?.trim() ?? "";
    const senderPhone = input.senderPhone?.trim() ?? "";
    if (senderName.length < 2 || senderPhone.length < 7) {
      throw new AppError(
        "Add the sender name and phone",
        "VALIDATION_ERROR",
        400,
      );
    }
    return {
      customerRole: "receiver",
      senderName,
      senderPhone: preferredPhone(senderPhone),
      receiverName: input.receiverName?.trim() || meName,
      receiverPhone: preferredPhone(input.receiverPhone || mePhone),
    };
  }

  const receiverName = input.receiverName?.trim() ?? "";
  const receiverPhone = input.receiverPhone?.trim() ?? "";
  if (receiverName.length < 2 || receiverPhone.length < 7) {
    throw new AppError(
      "Add the receiver name and phone",
      "VALIDATION_ERROR",
      400,
    );
  }
  return {
    customerRole: "sender",
    senderName: input.senderName?.trim() || meName,
    senderPhone: preferredPhone(input.senderPhone || mePhone),
    receiverName,
    receiverPhone: preferredPhone(receiverPhone),
  };
}

export async function placeOrder(input: PlaceOrderInput): Promise<OrderRow> {
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  if (!customer.active) {
    throw new AppError(
      "This account is inactive. Contact the KoboRide team.",
      "ACCOUNT_INACTIVE",
      403,
    );
  }

  const quote = await quoteRoute(input);
  let riderId: string | undefined;
  if (input.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: input.riderId },
    });
    if (!rider?.approved)
      throw new AppError("Rider is not approved", "RIDER_NOT_APPROVED", 400);
    riderId = rider.id;
  }

  const paymentMethod: PaymentMethod = input.paymentMethod === "paystack" ? "paystack" : "cash";
  let paymentStatus: PaymentStatus = "unpaid";
  let paystackReference: string | null = null;
  let paidAt: Date | null = null;

  if (paymentMethod === "paystack") {
    const ref = input.paystackReference?.trim();
    if (!ref) throw new AppError("Payment reference is missing", "VALIDATION_ERROR", 400);
    const used = await prisma.order.findUnique({ where: { paystackReference: ref } });
    if (used) throw new AppError("This payment was already used", "PAYMENT_ALREADY_USED", 409);
    const paid = await verifyPaystack(ref);
    if (paid.status !== "success") {
      throw new AppError("Payment was not successful", "PAYMENT_REQUIRED", 402);
    }
    if (paid.amountKobo !== nairaToKobo(quote.feeNgn)) {
      throw new AppError("Paid amount does not match the fare", "PAYMENT_MISMATCH", 409);
    }
    paymentStatus = "paid";
    paystackReference = ref;
    paidAt = new Date();
  }

  const maxActiveOrders = await getMaxActiveOrders();
  const order = await prisma.$transaction(async (tx) => {
    const active = await tx.order.count({
      where: {
        customerId: input.customerId,
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
    });
    if (active >= maxActiveOrders) {
      throw new AppError(
        `You can have at most ${maxActiveOrders} live orders. Finish or cancel one first.`,
        "ACTIVE_ORDER_LIMIT_REACHED",
        429,
      );
    }

    return tx.order.create({
      data: {
        customerId: input.customerId,
        pickup: quote.pickup,
        dropoff: quote.dropoff,
        notes: input.notes.trim(),
        senderName: input.senderName,
        senderPhone: input.senderPhone,
        receiverName: input.receiverName,
        receiverPhone: input.receiverPhone,
        customerRole: input.customerRole ?? "sender",
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        feeNgn: quote.feeNgn,
        payoutNgn: quote.payoutNgn,
        distanceKm: quote.distanceKm,
        paymentMethod,
        paymentStatus,
        paystackReference,
        paidAt,
        deliveryPin: generateDeliveryPin(),
        ...(riderId
          ? {
              riderId,
              status: "in_progress" as const,
              riderPhase: "accepted" as const,
            }
          : {}),
      },
      include: orderInclude,
    });
  });

  if (order.riderId) await notifyOrderAccepted(order);
  else await notifySearchingRider(order);
  await notifyAdminNewOrder(order);

  return order;
}
