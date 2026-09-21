import { api, json, options } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentRiderTrip } from "@/lib/orders";
import { availableJobsWhere, runOrderMaintenance } from "@/lib/dispatch";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const { rider } = await requireRider(req);
  await runOrderMaintenance();
  const orders = await prisma.order.findMany({
    where: availableJobsWhere(rider.zoneSlug),
    include: orderInclude,
    orderBy: { createdAt: "asc" },
  });
  return json({ trips: orders.map(presentRiderTrip) });
});
