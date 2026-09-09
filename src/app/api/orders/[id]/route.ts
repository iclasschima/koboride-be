import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { getOrderOrThrow, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  const user = requireUser(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);

  if (user.role === "admin") return json({ trip: presentTrip(order) });
  if (order.customerId === user.sub) return json({ trip: presentTrip(order) });

  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  const rider = customer
    ? await prisma.rider.findUnique({ where: { phone: customer.phone } })
    : null;
  if (rider && order.riderId === rider.id) return json({ trip: presentTrip(order) });

  throw new AppError("You cannot view this order", "FORBIDDEN", 403);
});
