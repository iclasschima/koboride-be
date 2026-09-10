import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const liveJobs = await prisma.order.count({
    where: { riderId: rider.id, status: "in_progress" },
  });
  if (liveJobs > 0) {
    throw new AppError("Finish your current job first.", "RIDER_BUSY", 409);
  }

  const taken = await prisma.order.updateMany({
    where: { id, status: "dispatching" },
    data: { riderId: rider.id, status: "in_progress", riderPhase: "accepted" },
  });
  if (taken.count === 0) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new AppError("Order not found", "ORDER_NOT_FOUND", 404);
    throw new AppError("This order was already taken", "ALREADY_ASSIGNED", 409);
  }

  const order = await prisma.order.findUniqueOrThrow({
    where: { id },
    include: orderInclude,
  });
  return json({ trip: presentTrip(order) });
});
