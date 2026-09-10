import { prisma } from "@/lib/prisma";
import { orderInclude, type OrderRow } from "@/lib/orders";
import { notifyOrderAccepted } from "@/lib/push";

export async function findDispatchRider() {
  const riders = await prisma.rider.findMany({
    where: { approved: true },
    orderBy: { createdAt: "asc" },
  });
  if (riders.length === 0) return null;

  const live = await prisma.order.findMany({
    where: { status: "in_progress", riderId: { not: null } },
    select: { riderId: true },
  });
  const busy = new Set(live.map((row) => row.riderId));

  const freeOnline = riders.find((rider) => rider.availability === "ONLINE" && !busy.has(rider.id));
  if (freeOnline) return freeOnline;
  if (riders.length === 1) return riders[0];
  return null;
}

export async function autoAssignOrder(orderId: string): Promise<OrderRow | null> {
  const rider = await findDispatchRider();
  if (!rider) return null;

  const updated = await prisma.order.updateMany({
    where: { id: orderId, status: "dispatching" },
    data: { riderId: rider.id, status: "in_progress", riderPhase: "accepted" },
  });
  if (updated.count === 0) return null;

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  await notifyOrderAccepted(order);
  return order;
}
