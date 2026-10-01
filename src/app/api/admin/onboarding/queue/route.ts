import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { adminRiderSecrets } from "@/lib/onboarding";
import { presentRiderBank } from "@/lib/riders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "riders");
  const riders = await prisma.rider.findMany({
    where: {
      onboardedByAgentId: { not: null },
      onboardingStatus: { in: ["SUBMITTED", "ID_VERIFIED"] },
    },
    orderBy: { submittedAt: "asc" },
    include: {
      onboardedByAgent: { select: { id: true, name: true, phone: true } },
    },
  });
  return json({
    riders: riders.map((rider) => ({
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      status: rider.onboardingStatus,
      idVerified: rider.idVerified,
      submittedAt: rider.submittedAt?.toISOString() ?? null,
      zoneId: rider.zoneSlug,
      depositPaid: rider.depositPaid,
      photoWithBikeUrl: rider.photoWithBikeUrl,
      selfieUrl: rider.selfieUrl,
      idDocumentUrl: rider.idDocumentUrl,
      nextOfKinName: rider.nextOfKinName,
      nextOfKinPhone: rider.nextOfKinPhone,
      idType: rider.idType,
      agent: rider.onboardedByAgent,
      ...adminRiderSecrets(rider),
      ...presentRiderBank(rider),
    })),
  });
});
