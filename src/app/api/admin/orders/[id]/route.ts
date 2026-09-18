import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrderOrThrow, presentRelease, presentTrip, refundIfPaidOnline } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
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
  return json({
    trip: { ...presentTrip(order), releases: releases.map(presentRelease) },
  });
});

export const DELETE = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);

  await refundIfPaidOnline(order);
  await prisma.order.delete({ where: { id } });
  return json({ ok: true });
});
