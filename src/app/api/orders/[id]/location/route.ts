import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const body = (await req.json()) as { lat?: unknown; lng?: unknown };
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("Location is required", "VALIDATION_ERROR", 400);
  }

  const updated = await prisma.order.updateMany({
    where: { id, riderId: rider.id, status: "in_progress" },
    data: { riderLat: lat, riderLng: lng, riderLocationAt: new Date() },
  });
  if (updated.count === 0) {
    throw new AppError("This job is not in progress", "INVALID_STATUS", 409);
  }

  return json({ ok: true });
});
