import type { Prisma } from "@prisma/client";
import { config, riderPayoutNgn } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { nairaToKobo, refundPaystack } from "@/lib/paystack";
import { prisma } from "@/lib/prisma";
import {
  cachedPlatformSettings,
  getPlatformSettings,
  minutesToMs,
  type PlatformSettings,
} from "@/lib/settings";
import {
  notifyAdminOrderStatus,
  notifyCustomerPaymentRefunded,
  notifySearchingRider,
} from "@/lib/push";

const AUTO_CANCEL_REASON = "No rider available after waiting";
const EMPTY_ZONE_CANCEL_REASON = "No riders in this area yet";

export const SYSTEM_CANCEL_REASONS = [
  AUTO_CANCEL_REASON,
  EMPTY_ZONE_CANCEL_REASON,
] as const;

const orderInclude = {
  rider: { select: { id: true, name: true, phone: true, photoUrl: true } },
  customer: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function isActivelyDispatching(
  order: {
    status: string;
    riderId: string | null;
    scheduledFor: Date | null;
  },
  now = new Date(),
): boolean {
  if (order.status !== "dispatching" || order.riderId) return false;
  if (order.scheduledFor && order.scheduledFor.getTime() > now.getTime()) return false;
  return true;
}

/**
 * Start of the current active search window.
 * Future scheduledFor → still paused; past scheduledFor → resumed at that time;
 * null → original create time.
 */
export function searchingSince(
  order: {
    createdAt: Date;
    scheduledFor: Date | null;
  },
  now = new Date(),
): Date {
  if (order.scheduledFor && order.scheduledFor.getTime() <= now.getTime()) {
    return order.scheduledFor;
  }
  return order.createdAt;
}

export function isScheduledPending(
  order: {
    status: string;
    scheduledFor: Date | null;
  },
  now = new Date(),
): boolean {
  return (
    order.status === "dispatching" &&
    order.scheduledFor != null &&
    order.scheduledFor.getTime() > now.getTime()
  );
}

export async function writeOrderEvent(
  orderId: string,
  type: string,
  payload?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.orderEvent.create({
    data: { orderId, type, payload: payload ?? undefined },
  });
}

/** Activate due merchant / reschedule holds so they re-enter the rider pool. */
export async function activateDueScheduledOrders(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({
    where: {
      status: "dispatching",
      riderId: null,
      scheduledFor: { lte: now },
    },
    include: orderInclude,
  });

  let activated = 0;
  for (const order of due) {
    const already = await prisma.orderEvent.findFirst({
      where: {
        orderId: order.id,
        type: "schedule_activated",
        createdAt: { gte: order.scheduledFor ?? order.createdAt },
      },
      select: { id: true },
    });
    if (already) continue;

    await writeOrderEvent(order.id, "schedule_activated", {
      scheduledFor: order.scheduledFor?.toISOString() ?? null,
      rescheduleCount: order.rescheduleCount,
    });
    await notifySearchingRider(order);
    activated += 1;
  }
  return activated;
}

async function cancelUnassignedSearch(
  order: OrderRow,
  now: Date,
  input: { reason: string; eventType: string },
): Promise<void> {
  const { refundIfPaidOnline } = await import("@/lib/orders");
  const refund = await refundIfPaidOnline(order);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "cancelled",
      cancelReason: input.reason,
      ...refund,
    },
    include: orderInclude,
  });
  const since = searchingSince(order, now);
  await writeOrderEvent(order.id, input.eventType, {
    searchingSince: since.toISOString(),
    waitedMs: now.getTime() - since.getTime(),
  });
  await notifyAdminOrderStatus(updated);
  if (refund.paymentStatus === "refunded") {
    await notifyCustomerPaymentRefunded(updated);
  }
}

async function zoneHasApprovedRiders(
  slug: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const hit = cache.get(slug);
  if (hit !== undefined) return hit;
  const hasRiders =
    (await prisma.rider.count({ where: { approved: true, zoneSlug: slug } })) > 0;
  cache.set(slug, hasRiders);
  return hasRiders;
}

/** Cancel empty-zone searches quickly, then stale searches. Order stays on file. */
async function autoCancelStaleSearching(now = new Date()): Promise<number> {
  const candidates = await prisma.order.findMany({
    where: { status: "dispatching", riderId: null },
    include: orderInclude,
  });

  const ridersByZone = new Map<string, boolean>();
  let cancelled = 0;
  for (const order of candidates) {
    if (isScheduledPending(order, now)) continue;
    const waited = now.getTime() - searchingSince(order, now).getTime();
    const empty =
      waited >= config.emptyZoneCancelAfterMs &&
      !(await zoneHasApprovedRiders(order.zoneSlug, ridersByZone));

    if (empty) {
      await cancelUnassignedSearch(order, now, {
        reason: EMPTY_ZONE_CANCEL_REASON,
        eventType: "auto_cancelled_empty_zone",
      });
      cancelled += 1;
      continue;
    }
    if (waited >= config.searchingAutoCancelAfterMs) {
      await cancelUnassignedSearch(order, now, {
        reason: AUTO_CANCEL_REASON,
        eventType: "auto_cancelled_no_rider",
      });
      cancelled += 1;
    }
  }
  return cancelled;
}

export async function runOrderMaintenance(now = new Date()): Promise<{
  activated: number;
  cancelled: number;
}> {
  const activated = await activateDueScheduledOrders(now);
  const cancelled = await autoCancelStaleSearching(now);
  return { activated, cancelled };
}

export function retentionDiscountNgn(feeNgn: number): number {
  return Math.max(0, Math.min(config.retentionDiscountNgn, feeNgn - 100));
}

export async function isSearchingLongEnough(
  order: {
    createdAt: Date;
    scheduledFor: Date | null;
    status: string;
    riderId: string | null;
  },
  now = new Date(),
): Promise<boolean> {
  if (!isActivelyDispatching(order, now)) return false;
  const settings = await getPlatformSettings();
  const since = searchingSince(order, now);
  return now.getTime() - since.getTime() >= minutesToMs(settings.stillLookingAfterMinutes);
}

export async function maybeRetentionOffer(order: OrderRow): Promise<{
  offerAvailable: true;
  discountAmount: number;
} | null> {
  if (order.retentionOfferShown) return null;
  if (!isActivelyDispatching(order)) return null;
  if (!(await isSearchingLongEnough(order))) return null;
  const discountAmount = retentionDiscountNgn(order.feeNgn);
  if (discountAmount <= 0) return null;

  await prisma.order.update({
    where: { id: order.id },
    data: { retentionOfferShown: true },
  });
  await writeOrderEvent(order.id, "retention_offer_shown", { discountNgn: discountAmount });
  return { offerAvailable: true, discountAmount };
}

export async function acceptRetentionOffer(
  orderId: string,
  customerId: string,
): Promise<OrderRow> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderInclude,
  });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);
  if (order.customerId !== customerId) {
    throw new AppError("Not your order", "FORBIDDEN", 403);
  }
  if (order.status !== "dispatching" || order.riderId) {
    throw new AppError(
      "This offer is only available while we are still searching for a rider",
      "NOT_SEARCHING",
      409,
    );
  }
  if (isScheduledPending(order)) {
    throw new AppError("This order is already scheduled", "ALREADY_SCHEDULED", 409);
  }
  if (!order.retentionOfferShown) {
    throw new AppError("This offer is not available", "NO_OFFER", 409);
  }

  const already = await prisma.orderEvent.findFirst({
    where: { orderId: order.id, type: "retention_discount" },
    select: { id: true },
  });
  if (already) {
    throw new AppError("This discount has already been applied", "OFFER_USED", 409);
  }

  const settings = await getPlatformSettings();
  const discount = retentionDiscountNgn(order.feeNgn);
  if (discount <= 0) {
    throw new AppError("No discount is available on this fare", "NO_DISCOUNT", 409);
  }
  const nextFee = Math.max(100, order.feeNgn - discount);
  const nextPayout = Math.min(
    riderPayoutNgn(nextFee, settings.platformCutPercent),
    nextFee,
  );

  if (
    order.paymentMethod === "paystack" &&
    order.paymentStatus === "paid" &&
    order.paystackReference
  ) {
    try {
      await refundPaystack(order.paystackReference, nairaToKobo(discount));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Refund failed";
      throw new AppError(
        `Could not apply the fare discount refund: ${message}`,
        "RETENTION_REFUND_FAILED",
        502,
      );
    }
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      retentionOfferShown: true,
      feeNgn: nextFee,
      payoutNgn: nextPayout,
    },
    include: orderInclude,
  });

  await writeOrderEvent(order.id, "retention_discount", {
    discountNgn: discount,
    previousFeeNgn: order.feeNgn,
    feeNgn: nextFee,
    payoutNgn: nextPayout,
  });

  return updated;
}

export function dispatchPresentation(
  order: {
    createdAt: Date;
    scheduledFor: Date | null;
    status: string;
    riderId: string | null;
    retentionOfferShown?: boolean;
  },
  now = new Date(),
  settings: PlatformSettings = cachedPlatformSettings(),
) {
  const pending = isScheduledPending(order, now);
  const active = isActivelyDispatching(order, now);
  const since = searchingSince(order, now);
  const searchingForMs = active ? Math.max(0, now.getTime() - since.getTime()) : 0;
  return {
    scheduledFor: order.scheduledFor?.toISOString() ?? null,
    searchingSince: since.toISOString(),
    scheduledPending: pending,
    stillLookingAfterMs: minutesToMs(settings.stillLookingAfterMinutes),
    retentionOfferShown: Boolean(order.retentionOfferShown),
    retentionDiscountNgn: config.retentionDiscountNgn,
    autoCancelInMs: active
      ? Math.max(0, config.searchingAutoCancelAfterMs - searchingForMs)
      : null,
  };
}

export function availableJobsWhere(
  zoneSlug: string,
  now = new Date(),
): Prisma.OrderWhereInput {
  return {
    status: "dispatching",
    riderId: null,
    zoneSlug,
    OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
  };
}

export function acceptDispatchingWhere(
  id: string,
  zoneSlug: string,
  now = new Date(),
): Prisma.OrderWhereInput {
  return {
    id,
    status: "dispatching",
    riderId: null,
    zoneSlug,
    OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
  };
}
