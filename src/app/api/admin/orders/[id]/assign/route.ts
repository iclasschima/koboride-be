import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";
import { notifyOrderAccepted } from "@/lib/push";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const { riderId } = parseBody(z.object({ riderId: z.string().min(1) }), await readJson(req));
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);

  const canAssign =
    order.status === "dispatching" ||
    (order.status === "in_progress" && order.riderPhase !== "delivered");
  if (!canAssign) {
    throw new AppError("This order can no longer be assigned", "INVALID_STATUS", 409);
  }

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider?.approved) throw new AppError("Rider is not approved", "RIDER_NOT_APPROVED", 400);
  if (order.riderId === rider.id) {
    throw new AppError("That rider is already assigned", "ALREADY_ASSIGNED", 409);
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { riderId: rider.id, status: "in_progress", riderPhase: "accepted" },
    include: orderInclude,
  });
  if (order.status === "dispatching") {
    await notifyOrderAccepted(updated);
  }
  return json({ trip: presentTrip(updated) });
});
