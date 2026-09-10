import type { Prisma, RiderPhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { quoteRoute } from "@/lib/fare";
import { notifyOrderAccepted, notifySearchingRider } from "@/lib/push";

export const orderInclude = {
  rider: { select: { id: true, name: true, phone: true } },
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

function autoConfirmMs(): number {
  return config.autoConfirmMinutes * 60 * 1000;
}

function isDeliveredAwaitingConfirm(order: {
  status: string;
  riderPhase: RiderPhase | null;
}): boolean {
  return order.status === "in_progress" && order.riderPhase === "delivered";
}

function isAutoConfirmDue(order: { updatedAt: Date }): boolean {
  return Date.now() - order.updatedAt.getTime() >= autoConfirmMs();
}

/** Complete delivered jobs the customer never confirmed. */
export async function autoConfirmStaleDeliveries(): Promise<void> {
  await prisma.order.updateMany({
    where: {
      status: "in_progress",
      riderPhase: "delivered",
      updatedAt: { lte: new Date(Date.now() - autoConfirmMs()) },
    },
    data: { status: "completed" },
  });
}

export async function getOrderOrThrow(id: string): Promise<OrderRow> {
  const order = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);
  if (isDeliveredAwaitingConfirm(order) && isAutoConfirmDue(order)) {
    return prisma.order.update({
      where: { id: order.id },
      data: { status: "completed", riderPhase: "delivered" },
      include: orderInclude,
    });
  }
  return order;
}

export function presentTrip(order: OrderRow) {
  const awaiting = isDeliveredAwaitingConfirm(order);
  return {
    id: order.id,
    pickup: order.pickup,
    dropoff: order.dropoff,
    notes: order.notes ?? "",
    senderName: order.senderName,
    senderPhone: order.senderPhone,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    feeNgn: order.feeNgn,
    status: order.status,
    riderPhase: order.riderPhase,
    riderId: order.riderId,
    riderName: order.rider?.name ?? null,
    riderPhone: order.rider?.phone ?? null,
    customerName: order.customer?.name ?? null,
    customerPhone: order.customer?.phone ?? null,
    payoutNgn: order.payoutNgn,
    payoutPaid: order.payoutPaid,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    autoConfirmInMs: awaiting
      ? Math.max(0, order.updatedAt.getTime() + autoConfirmMs() - Date.now())
      : null,
  };
}

export function nextPhase(phase: RiderPhase | null): RiderPhase | null {
  if (!phase) return "accepted";
  const i = RIDER_PHASES.indexOf(phase);
  if (i < 0 || i >= RIDER_PHASES.length - 1) return phase;
  return RIDER_PHASES[i + 1]!;
}

export function assertCustomerOwns(order: { customerId: string }, userId: string) {
  if (order.customerId !== userId) {
    throw new AppError("This order does not belong to you", "FORBIDDEN", 403);
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
  riderId?: string;
};

export async function placeOrder(input: PlaceOrderInput): Promise<OrderRow> {
  const quote = quoteRoute(input);
  let riderId: string | undefined;
  if (input.riderId) {
    const rider = await prisma.rider.findUnique({ where: { id: input.riderId } });
    if (!rider?.approved) throw new AppError("Rider is not approved", "RIDER_NOT_APPROVED", 400);
    riderId = rider.id;
  }

  const order = await prisma.order.create({
    data: {
      customerId: input.customerId,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      notes: input.notes.trim(),
      senderName: input.senderName,
      senderPhone: input.senderPhone,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      dropoffLat: quote.dropoffLat,
      dropoffLng: quote.dropoffLng,
      feeNgn: quote.feeNgn,
      payoutNgn: quote.payoutNgn,
      ...(riderId
        ? { riderId, status: "in_progress" as const, riderPhase: "accepted" as const }
        : {}),
    },
    include: orderInclude,
  });

  if (order.riderId) await notifyOrderAccepted(order);
  else await notifySearchingRider(order);

  return order;
}
