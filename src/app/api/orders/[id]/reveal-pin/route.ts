import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { assertCustomerOwns, getOrderOrThrow, orderInclude, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  assertCustomerOwns(order, user.sub);

  if (order.status === "completed" || order.status === "cancelled") {
    throw new AppError("This order is no longer active", "INVALID_STATUS", 409);
  }

  if (order.deliveryPinRevealedAt) {
    return json({ trip: presentTrip(order) });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { deliveryPinRevealedAt: new Date() },
    include: orderInclude,
  });
  return json({ trip: presentTrip(updated) });
});
