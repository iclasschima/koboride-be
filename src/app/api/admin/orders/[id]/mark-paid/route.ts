import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { getOrderOrThrow, orderInclude, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  if (order.status !== "completed") {
    throw new AppError("Payouts are only for completed orders", "INVALID_STATUS", 409);
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { payoutPaid: true },
    include: orderInclude,
  });
  return json({ trip: presentTrip(updated) });
});
