import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { writeOnboardingEvent } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const admin = await requireAdmin(req, "riders");
  const riderId = ctx.params?.riderId;
  if (!riderId) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || !rider.onboardedByAgentId) {
    throw new AppError("Rider not found", "NOT_FOUND", 404);
  }
  if (rider.onboardingStatus === "REJECTED" || rider.onboardingStatus === "APPROVED") {
    throw new AppError("This submission is already closed", "INVALID_STATUS", 409);
  }

  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: {
      idVerified: true,
      onboardingStatus: rider.onboardingStatus === "SUBMITTED" ? "ID_VERIFIED" : rider.onboardingStatus,
    },
  });
  await writeOnboardingEvent({
    riderId: rider.id,
    actorId: admin.sub,
    actorRole: "admin",
    action: "ID_VERIFIED",
  });
  return json({
    rider: { id: updated.id, status: updated.onboardingStatus, idVerified: updated.idVerified },
  });
});
