import { api, json, options } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireRider(req);
  const orders = await prisma.order.findMany({
    where: { status: "dispatching" },
    include: orderInclude,
    orderBy: { createdAt: "asc" },
  });
  return json({ trips: orders.map(presentTrip) });
});
