import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { orderInclude, presentTrip } from "@/lib/orders";
import { zoneName } from "@/lib/zones";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const orders = await prisma.order.findMany({
    where: { status: { in: ["dispatching", "in_progress"] } },
    include: orderInclude,
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const jobByRider = new Map<string, (typeof orders)[number]>();
  for (const order of orders) {
    if (order.status === "in_progress" && order.riderId) jobByRider.set(order.riderId, order);
  }

  const riders = await prisma.rider.findMany({
    where: {
      approved: true,
      OR: [{ availability: "ONLINE" }, { id: { in: Array.from(jobByRider.keys()) } }],
    },
    select: {
      id: true,
      name: true,
      photoUrl: true,
      zoneSlug: true,
      availability: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
    },
    orderBy: { name: "asc" },
  });

  return json({
    riders: riders.map((rider) => {
      const job = jobByRider.get(rider.id);
      const jobFix =
        job?.riderLat != null && job.riderLng != null && job.riderLocationAt
          ? { lat: job.riderLat, lng: job.riderLng, at: job.riderLocationAt }
          : null;
      const ownFix =
        rider.lastLat != null && rider.lastLng != null && rider.lastLocationAt
          ? { lat: rider.lastLat, lng: rider.lastLng, at: rider.lastLocationAt }
          : null;
      const fix =
        jobFix && (!ownFix || jobFix.at > ownFix.at) ? jobFix : ownFix;
      return {
        id: rider.id,
        name: rider.name,
        photoUrl: rider.photoUrl,
        zoneSlug: rider.zoneSlug,
        zoneName: zoneName(rider.zoneSlug),
        online: rider.availability === "ONLINE",
        lat: fix?.lat ?? null,
        lng: fix?.lng ?? null,
        locationAt: fix?.at.toISOString() ?? null,
        orderId: job?.id ?? null,
      };
    }),
    trips: orders.map(presentTrip),
    at: new Date().toISOString(),
  });
});
