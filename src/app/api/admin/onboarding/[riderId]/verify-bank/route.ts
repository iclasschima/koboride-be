import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { verifyRiderBank } from "@/lib/bankVerify";
import { presentRiderBank } from "@/lib/riders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const admin = requireUser(req, ["admin"]);
  const riderId = ctx.params?.riderId;
  if (!riderId) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || !rider.onboardedByAgentId) {
    throw new AppError("Rider not found", "NOT_FOUND", 404);
  }

  await verifyRiderBank(rider.id, admin.sub);
  const updated = await prisma.rider.findUnique({ where: { id: rider.id } });
  if (!updated) throw new AppError("Rider not found", "NOT_FOUND", 404);
  return json({ bank: presentRiderBank(updated) });
});
