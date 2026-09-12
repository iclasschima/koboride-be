import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { getOrderOrThrow, nextPhase, orderInclude, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyAdminOrderStatus, notifyOrderDelivered } from "@/lib/push";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  if (order.riderId !== rider.id) {
    throw new AppError("You are not assigned to this order", "FORBIDDEN", 403);
  }
  if (order.status !== "in_progress") {
    throw new AppError("This job is not in progress", "INVALID_STATUS", 409);
  }

  const riderPhase = nextPhase(order.riderPhase);
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { riderPhase },
    include: orderInclude,
  });
  if (riderPhase === "delivered" && order.riderPhase !== "delivered") {
    await notifyOrderDelivered(updated);
  }
  if (riderPhase !== order.riderPhase) {
    await notifyAdminOrderStatus(updated);
  }
  return json({ trip: presentTrip(updated) });
});
