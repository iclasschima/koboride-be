import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { getOrderOrThrow, orderInclude, presentRiderTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyDeliveryPinRequested } from "@/lib/push";

const REQUEST_COOLDOWN_MS = 30_000;

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

  if (order.deliveryPinRevealedAt) {
    return json({ trip: presentRiderTrip(order) });
  }

  const last = order.deliveryPinRequestedAt?.getTime() ?? 0;
  if (Date.now() - last < REQUEST_COOLDOWN_MS) {
    return json({ trip: presentRiderTrip(order) });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { deliveryPinRequestedAt: new Date() },
    include: orderInclude,
  });
  await notifyDeliveryPinRequested(updated);
  return json({ trip: presentRiderTrip(updated) });
});
