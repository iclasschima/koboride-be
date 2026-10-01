import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { writeOnboardingEvent } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const admin = await requireAdmin(req, "riders");
  const riderId = ctx.params?.riderId;
  if (!riderId) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);
  const body = parseBody(
    z.object({ reason: z.string().trim().min(3).max(300) }),
    await readJson(req),
  );

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || !rider.onboardedByAgentId) {
    throw new AppError("Rider not found", "NOT_FOUND", 404);
  }
  if (rider.onboardingStatus === "APPROVED") {
    throw new AppError("An approved rider stays attributed to their agent", "INVALID_STATUS", 409);
  }
  if (rider.onboardingStatus === "REJECTED") {
    return json({ rider: { id: rider.id, status: rider.onboardingStatus } });
  }

  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: {
      approved: false,
      onboardingStatus: "REJECTED",
      rejectionReason: body.reason,
    },
  });
  await writeOnboardingEvent({
    riderId: rider.id,
    actorId: admin.sub,
    actorRole: "admin",
    action: "REJECTED",
    note: body.reason,
  });
  return json({ rider: { id: updated.id, status: updated.onboardingStatus } });
});
