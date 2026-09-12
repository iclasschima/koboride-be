import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { assertCustomerOwns, getOrderOrThrow, orderInclude, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyAdminOrderStatus } from "@/lib/push";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  assertCustomerOwns(order, user.sub);
  if (order.status !== "dispatching") {
    throw new AppError("You can only cancel before a rider is assigned", "INVALID_STATUS", 409);
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "cancelled" },
    include: orderInclude,
  });
  await notifyAdminOrderStatus(updated);
  return json({ trip: presentTrip(updated) });
});
