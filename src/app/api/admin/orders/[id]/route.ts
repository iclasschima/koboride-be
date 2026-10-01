import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { getOrderOrThrow, presentRelease, presentTrip, refundIfPaidOnline } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, "orders");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const [order, releases] = await Promise.all([
    getOrderOrThrow(id),
    prisma.orderRelease.findMany({
      where: { orderId: id },
      include: { rider: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const trip = presentTrip(order);
  if (order.status === "in_progress" && order.riderId) {
    const rider = await prisma.rider.findUnique({
      where: { id: order.riderId },
      select: { lastLat: true, lastLng: true, lastLocationAt: true },
    });
    if (
      rider?.lastLat != null &&
      rider.lastLng != null &&
      rider.lastLocationAt &&
      (!order.riderLocationAt || rider.lastLocationAt > order.riderLocationAt)
    ) {
      trip.riderLat = rider.lastLat;
      trip.riderLng = rider.lastLng;
      trip.riderLocationAt = rider.lastLocationAt.toISOString();
    }
  }
  return json({
    trip: { ...trip, releases: releases.map(presentRelease) },
  });
});

export const DELETE = api(async (req, ctx) => {
  await requireAdmin(req, "orders");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);

  await refundIfPaidOnline(order);
  await prisma.order.delete({ where: { id } });
  return json({ ok: true });
});
