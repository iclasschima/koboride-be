import { api, json, options } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoConfirmStaleDeliveries, orderInclude, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const { rider } = await requireRider(req);
  await autoConfirmStaleDeliveries();
  const orders = await prisma.order.findMany({
    where: { riderId: rider.id, status: "in_progress" },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return json({ trips: orders.map(presentTrip) });
});
