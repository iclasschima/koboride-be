import { randomInt, timingSafeEqual } from "node:crypto";
import type { CustomerRole, PaymentMethod, PaymentStatus, Prisma, RiderPhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { quoteRoute } from "@/lib/fare";
import { assertOfferUsesAvailable } from "@/lib/locationOffers";
import { osrmRoute } from "@/lib/osrm";
import { DEFAULT_SHOP_PACKAGE } from "@/lib/packages";
import { preferredPhone } from "@/lib/phone";
import { getMaxActiveOrders } from "@/lib/settings";
import { zoneName } from "@/lib/zones";
import { nairaToKobo, refundPaystack, verifyPaystack } from "@/lib/paystack";
import {
  notifyAdminNewOrder,
  notifyAdminOrderStatus,
  notifyCustomerPaymentRefunded,
  notifyOrderAccepted,
  notifyRiderOrderCancelled,
  notifySearchingRider,
} from "@/lib/push";
import {
  dispatchPresentation,
  SYSTEM_CANCEL_REASONS,
  writeOrderEvent,
} from "@/lib/dispatch";
import { noteRiderFirstTen } from "@/lib/onboarding";
import { writeConfirmedLedgerNow } from "@/lib/ledger";
import { onlinePaymentsEnabled } from "@/lib/payoutFlags";

export const orderInclude = {
  rider: { select: { id: true, name: true, phone: true, photoUrl: true } },
  customer: { select: { id: true, name: true, phone: true } },
  merchant: { select: { id: true, name: true, slug: true } },
  lines: { orderBy: { id: "asc" as const } },
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
  const stale = await prisma.order.findMany({
    where: {
      status: "in_progress",
      riderPhase: "delivered",
    },
    select: { id: true, riderId: true },
  });
  await prisma.order.updateMany({
    where: {
      status: "in_progress",
      riderPhase: "delivered",
    },
    data: orderCompletedData(),
  });
  const riderIds = Array.from(
    new Set(stale.map((order) => order.riderId).filter((id): id is string => Boolean(id))),
  );
  const confirmed = await prisma.order.findMany({
    where: { id: { in: stale.map((order) => order.id) } },
    select: { id: true, riderId: true, paymentMethod: true, feeNgn: true, payoutNgn: true, status: true },
  });
  await Promise.all(confirmed.map((order) => writeConfirmedLedgerNow(order)));
  await Promise.all(riderIds.map((riderId) => noteRiderFirstTen(riderId)));
}

export async function getOrderOrThrow(id: string): Promise<OrderRow> {
  const order = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);
  const completing = isDeliveredAwaitingConfirm(order);
  const current = completing
    ? await prisma.order.update({
        where: { id: order.id },
        data: orderCompletedData(),
        include: orderInclude,
      })
    : order;
  if (completing) {
    await writeConfirmedLedgerNow(current);
    await noteRiderFirstTen(current.riderId);
  }
  return cacheOrderRoute(current);
}

async function cacheOrderRoute(order: OrderRow): Promise<OrderRow> {
  if (order.routeGeometry) return order;
  const routed = await osrmRoute(
    order.pickupLat,
    order.pickupLng,
    order.dropoffLat,
    order.dropoffLng,
  );
  if (!routed) return order;
  return prisma.order.update({
    where: { id: order.id },
    data: {
      routeGeometry: routed.geometry,
      routeDurationSeconds: routed.durationSeconds,
    },
    include: orderInclude,
  });
}

export function generateDeliveryPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

export function deliveryPinsMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given.replace(/\D/g, "").padStart(4, "0").slice(-4));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** PIN is only for send jobs — the customer is not at drop-off. */
export function orderNeedsDeliveryPin(order: {
  customerRole: string | null;
  deliveryPin?: string | null;
}): boolean {
  return order.customerRole !== "receiver" && Boolean(order.deliveryPin);
}

function toTrip(order: OrderRow, hideDeliveryPin: boolean) {
  return {
    id: order.id,
    pickup: order.pickup,
    dropoff: order.dropoff,
    pickupLat: order.pickupLat,
    pickupLng: order.pickupLng,
    dropoffLat: order.dropoffLat,
    dropoffLng: order.dropoffLng,
    notes: readableOrderNotes(order.notes),
    senderName: order.senderName,
    senderPhone: order.senderPhone,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    customerRole: order.customerRole,
    farePayer: order.farePayer,
    zoneSlug: order.zoneSlug,
    zoneName: zoneName(order.zoneSlug),
    feeNgn: order.feeNgn,
    goodsNgn: order.goodsNgn,
    paymentFeeNgn: order.paymentFeeNgn,
    packageType: order.packageType,
    bagCount: order.bagCount,
    merchantId: order.merchantId,
    merchantName: order.merchant?.name ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    lines: order.lines.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      priceNgn: line.priceNgn,
      bagIndex: line.bagIndex,
    })),
    status: order.status,
    riderPhase: order.riderPhase,
    riderId: order.riderId,
    riderName: order.rider?.name ?? null,
    riderPhone: order.rider?.phone ?? null,
    riderPhotoUrl: order.rider?.photoUrl ?? null,
    riderLat: order.riderLat,
    riderLng: order.riderLng,
    riderLocationAt: order.riderLocationAt?.toISOString() ?? null,
    customerName: order.customer?.name ?? null,
    customerPhone: order.customer?.phone ?? null,
    payoutNgn: order.payoutNgn,
    payoutPaid: order.payoutPaid,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    distanceKm: order.distanceKm,
    routeGeometry: order.routeGeometry ?? null,
    routeDurationSeconds: order.routeDurationSeconds ?? null,
    deliveryPin:
      hideDeliveryPin || !orderNeedsDeliveryPin(order) ? null : order.deliveryPin,
    deliveryPinRevealed: Boolean(order.deliveryPinRevealedAt),
    deliveryPinRequested: Boolean(order.deliveryPinRequestedAt),
    deliveryPinRequestedAt: order.deliveryPinRequestedAt?.toISOString() ?? null,
    deliveryPinSentAt: order.deliveryPinSentAt?.toISOString() ?? null,
    requiresDeliveryPin: orderNeedsDeliveryPin(order),
    deliveryProof: order.deliveryProof,
    deliveryProofNote: order.deliveryProofNote,
    deliveryProofPhotoUrl: order.deliveryProofPhotoUrl,
    cancelReason: order.cancelReason,
    ...dispatchPresentation(order),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    durationSeconds: orderDurationSeconds(order),
    autoConfirmInMs: null,
  };
}

export function presentTrip(order: OrderRow) {
  return toTrip(order, shouldHideCustomerDeliveryPin(order));
}

/** Hide the PIN while searching; show it once a rider has accepted. */
function shouldHideCustomerDeliveryPin(order: OrderRow): boolean {
  return order.status !== "in_progress";
}

/** Marks a checkout note the customer addressed to the rider, not the shop. */
const RIDER_NOTE_MARK = "[[rider]]";

/** Item summary, then either the shop note or a marked rider note. */
export function composeOrderNotes(summary: string, note: string, noteFor: "shop" | "rider"): string {
  const extra = note.trim();
  if (!extra) return summary;
  const line = noteFor === "rider" ? `${RIDER_NOTE_MARK}${extra.replace(/\s+/g, " ")}` : extra;
  return [summary, line].filter(Boolean).join("\n");
}

/** Shop notes stay with the shop. A rider note is returned on its own. */
export function splitOrderNotes(notes: string | null | undefined): { shopNotes: string; riderNote: string } {
  const text = notes?.trim() ?? "";
  if (!text) return { shopNotes: "", riderNote: "" };
  let riderNote = "";
  const shopLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(RIDER_NOTE_MARK)) riderNote = line.slice(RIDER_NOTE_MARK.length).trim();
    else shopLines.push(line);
  }
  return { shopNotes: shopLines.join("\n").trim(), riderNote };
}

/** Customer and admin copy. The storage mark stays off the screen. */
export function readableOrderNotes(notes: string | null | undefined): string {
  const { shopNotes, riderNote } = splitOrderNotes(notes);
  if (!riderNote) return shopNotes;
  return [shopNotes, `For the rider: ${riderNote}`].filter(Boolean).join("\n");
}

/** Riders see the kind of shop bag, never the items or a note addressed to the shop. */
export function presentRiderTrip(order: OrderRow) {
  const trip = toTrip(order, !order.deliveryPinRevealedAt);
  if (!order.merchantId) return trip;
  const bag = order.packageType ?? DEFAULT_SHOP_PACKAGE;
  const packed = order.bagCount > 1 ? `${order.bagCount} × ${bag}` : bag;
  const { riderNote } = splitOrderNotes(order.notes);
  return { ...trip, notes: riderNote ? `${packed}\n${riderNote}` : packed, lines: [], goodsNgn: 0, paymentFeeNgn: 0 };
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
      NOT: { cancelReason: { in: [...SYSTEM_CANCEL_REASONS] } },
    },
  });
}

export function isCancelLimited(recentCancels: number): boolean {
  return recentCancels >= config.maxCancelsPerWindow;
}

export function cancelWindowLabel(hours = config.cancelWindowHours): string {
  return hours === 1 ? "hour" : `${hours} hours`;
}

export function cancelHoldMessage(): string {
  return `You've cancelled ${config.maxCancelsPerWindow} orders in the last ${cancelWindowLabel()}. You can book again later.`;
}

export function assertCustomerCancelAllowed(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): void {
  if (!customerCanCancel(order)) {
    throw new AppError(
      "You can only cancel before the rider picks up the package",
      "ALREADY_PICKED_UP",
      409,
    );
  }
}

export async function assertCustomerCanBook(customerId: string): Promise<void> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { cancelLimitResetAt: true },
  });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  const recent = await countRecentCancels(customerId, customer.cancelLimitResetAt);
  if (isCancelLimited(recent)) {
    throw new AppError(cancelHoldMessage(), "CANCEL_LIMIT_REACHED", 429);
  }
}

export async function refundIfPaidOnline(order: {
  id?: string;
  riderId?: string | null;
  status?: string;
  feeNgn?: number;
  payoutNgn?: number;
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

/** A failed refund leaves the payment "paid", so `retryFailedRefunds` picks it up later. */
export async function refundOrRetryLater(order: Parameters<typeof refundIfPaidOnline>[0] & { id: string }) {
  try {
    return await refundIfPaidOnline(order);
  } catch (err) {
    console.error("[refund]", order.id, err);
    return {};
  }
}

/**
 * Cancels an order the rider has not picked up and refunds its card payment.
 * The status check runs in the same update as the cancel, so a pickup at the
 * same moment wins. Returns null when it is too late to cancel.
 */
export async function cancelOrder(
  order: OrderRow,
  input: {
    reason: string;
    event: string;
    eventData?: Record<string, Prisma.InputJsonValue>;
    searchingOnly?: boolean;
  },
): Promise<OrderRow | null> {
  const { count } = await prisma.order.updateMany({
    where: input.searchingOnly
      ? { id: order.id, status: "dispatching", riderId: null }
      : {
          id: order.id,
          status: { in: ["dispatching", "in_progress"] },
          OR: [{ riderPhase: null }, { riderPhase: { notIn: PICKED_UP } }],
        },
    data: { status: "cancelled", cancelReason: input.reason },
  });
  if (count === 0) return null;

  const refund = await refundOrRetryLater(order);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: refund,
    include: orderInclude,
  });
  const refunded = refund.paymentStatus === "refunded";
  await writeOrderEvent(order.id, input.event, { ...input.eventData, refunded });
  await notifyAdminOrderStatus(updated);
  if (updated.riderId) await notifyRiderOrderCancelled(updated);
  if (refunded) await notifyCustomerPaymentRefunded(updated);
  return updated;
}

const REFUND_RETRY_DAYS = 3;

export async function retryFailedRefunds(now = new Date()): Promise<number> {
  const orders = await prisma.order.findMany({
    where: {
      status: "cancelled",
      paymentMethod: "paystack",
      paymentStatus: "paid",
      paystackReference: { not: null },
      updatedAt: { gte: new Date(now.getTime() - REFUND_RETRY_DAYS * 24 * 60 * 60 * 1000) },
    },
    include: orderInclude,
    take: 20,
  });
  let refunded = 0;
  for (const order of orders) {
    const refund = await refundOrRetryLater(order);
    if (refund.paymentStatus !== "refunded") continue;
    const updated = await prisma.order.update({ where: { id: order.id }, data: refund, include: orderInclude });
    await writeOrderEvent(order.id, "refund_retried");
    await notifyCustomerPaymentRefunded(updated);
    refunded += 1;
  }
  return refunded;
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
  farePayer?: CustomerRole;
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

  const paymentMethod: PaymentMethod = input.paymentMethod === "paystack" ? "paystack" : "cash";
  if (paymentMethod === "paystack" && !(await onlinePaymentsEnabled())) {
    throw new AppError("Online payment is not available right now", "ONLINE_PAYMENTS_DISABLED", 403);
  }
  const customerRole: CustomerRole =
    input.customerRole === "receiver" ? "receiver" : "sender";
  const farePayer: CustomerRole =
    input.farePayer === "receiver" || input.farePayer === "sender"
      ? input.farePayer
      : customerRole;
  if (paymentMethod === "paystack" && farePayer !== customerRole) {
    throw new AppError(
      "Only the person booking can pay online. Choose cash if the other person will pay.",
      "VALIDATION_ERROR",
      400,
    );
  }
  const quote = await quoteRoute({ ...input, paymentMethod });
  let riderId: string | undefined;
  if (input.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: input.riderId },
    });
    if (!rider?.approved)
      throw new AppError("Rider is not approved", "RIDER_NOT_APPROVED", 400);
    if (rider.zoneSlug !== quote.zoneSlug) {
      throw new AppError(
        `This rider is assigned to ${zoneName(rider.zoneSlug)}, not ${zoneName(quote.zoneSlug)}.`,
        "ZONE_MISMATCH",
        400,
      );
    }
    riderId = rider.id;
  }

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
    await assertOfferUsesAvailable(input.customerId, [quote.pickupOfferId, quote.dropoffOfferId], tx);

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
        customerRole,
        farePayer,
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        pickupOfferId: quote.pickupOfferId,
        dropoffOfferId: quote.dropoffOfferId,
        zoneSlug: quote.zoneSlug,
        feeNgn: quote.feeNgn,
        payoutNgn: quote.payoutNgn,
        distanceKm: quote.distanceKm,
        routeGeometry: quote.routeGeometry ?? undefined,
        routeDurationSeconds: quote.routeDurationSeconds,
        paymentMethod,
        paymentStatus,
        paystackReference,
        paidAt,
        deliveryPin: customerRole === "sender" ? generateDeliveryPin() : "",
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
