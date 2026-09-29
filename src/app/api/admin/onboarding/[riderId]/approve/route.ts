import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { writeOnboardingEvent } from "@/lib/onboarding";
import { verifyRiderBank } from "@/lib/bankVerify";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/validate";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const admin = requireUser(req, ["admin"]);
  const riderId = ctx.params?.riderId;
  if (!riderId) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AppError("Request body must be JSON", "INVALID_JSON", 400);
    }
  }
  const body = parseBody(
    z.object({ overrideNote: z.string().trim().min(3).max(300).optional() }),
    raw,
  );

  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider || !rider.onboardedByAgentId) {
    throw new AppError("Rider not found", "NOT_FOUND", 404);
  }
  if (rider.onboardingStatus === "APPROVED") {
    return json({ rider: { id: rider.id, status: rider.onboardingStatus, approved: rider.approved } });
  }
  if (rider.onboardingStatus === "REJECTED") {
    throw new AppError("This rider was rejected", "INVALID_STATUS", 409);
  }
  if (!rider.idVerified && !body.overrideNote) {
    throw new AppError(
      "Verify the ID first, or add an override note",
      "ID_NOT_VERIFIED",
      409,
    );
  }

  const now = new Date();
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: {
      approved: true,
      onboardingStatus: "APPROVED",
      approvedAt: now,
    },
  });
  void verifyRiderBank(updated.id, admin.sub).catch(() => undefined);
  await writeOnboardingEvent({
    riderId: rider.id,
    actorId: admin.sub,
    actorRole: "admin",
    action: body.overrideNote ? "APPROVED_OVERRIDE" : "APPROVED",
    note: body.overrideNote,
  });
  return json({
    rider: { id: updated.id, status: updated.onboardingStatus, approved: updated.approved },
  });
});
