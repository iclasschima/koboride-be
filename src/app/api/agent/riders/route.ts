import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { presentAgentRider, submitRiderForAgent } from "@/lib/onboarding";
import { RIDER_ID_TYPES } from "@/lib/riders";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

const submitSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().min(10),
  idType: z.enum(RIDER_ID_TYPES),
  idNumber: z.string().trim().min(4).max(40),
  bankName: z.string().trim().min(2).max(80),
  bankCode: z.string().trim().min(2).max(10),
  bankAccountNo: z.string().trim().min(10).max(20),
  nextOfKinName: z.string().trim().min(2).max(80),
  nextOfKinPhone: z.string().min(10),
  zoneId: z.string().trim().min(1).max(20),
  photoWithBikeUrl: z.string().url(),
  selfieUrl: z.string().url(),
  depositPaid: z.boolean(),
});

export const POST = api(async (req) => {
  const { agent } = await requireAgent(req);
  const body = parseBody(submitSchema, await readJson(req));
  const rider = await submitRiderForAgent(agent.id, body);
  return json({ rider }, 201);
});

export const GET = api(async (req) => {
  const { agent } = await requireAgent(req);
  const riders = await prisma.rider.findMany({
    where: { onboardedByAgentId: agent.id },
    orderBy: { submittedAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      onboardingStatus: true,
      submittedAt: true,
      approvedAt: true,
      firstTenReachedAt: true,
      zoneSlug: true,
    },
  });
  const counts = riders.length
    ? await prisma.order.groupBy({
        by: ["riderId"],
        where: {
          riderId: { in: riders.map((rider) => rider.id) },
          status: "completed",
        },
        _count: { _all: true },
      })
    : [];
  const completed = new Map(counts.map((row) => [row.riderId, row._count._all]));
  return json({
    riders: riders.map((rider) =>
      presentAgentRider({ ...rider, completedCount: completed.get(rider.id) ?? 0 }),
    ),
  });
});
