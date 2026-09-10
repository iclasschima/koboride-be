import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoConfirmStaleDeliveries, orderInclude, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  await autoConfirmStaleDeliveries();
  const orders = await prisma.order.findMany({
    include: orderInclude,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return json({ trips: orders.map(presentTrip) });
});
