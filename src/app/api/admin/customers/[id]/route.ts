import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";
import { phoneLookupKeys } from "@/lib/phone";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing customer id", "VALIDATION_ERROR", 400);

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      _count: { select: { orders: true } },
      orders: {
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);

  const rider = await prisma.rider.findFirst({
    where: { phone: { in: phoneLookupKeys(customer.phone) } },
    select: { id: true, approved: true },
  });

  const spentNgn = customer.orders
    .filter((o) => o.status === "in_progress" || o.status === "completed")
    .reduce((sum, o) => sum + o.feeNgn, 0);
  const last = customer.orders[0];

  return json({
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      createdAt: customer.createdAt.toISOString(),
      ordersCount: customer._count.orders,
      lastOrderAt: last?.createdAt.toISOString() ?? null,
      lastOrderStatus: last?.status ?? null,
      spentNgn,
      isRider: Boolean(rider),
    },
    trips: customer.orders.map(presentTrip),
  });
});
