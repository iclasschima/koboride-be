import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { computeAgentEarnings, currentEarningsMonth } from "@/lib/agentEarnings";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, "agents");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing agent id", "VALIDATION_ERROR", 400);
  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!agent) throw new AppError("Agent not found", "NOT_FOUND", 404);
  const month = new URL(req.url).searchParams.get("month") ?? currentEarningsMonth();
  return json({
    agent: { id: agent.id, name: agent.name },
    earnings: await computeAgentEarnings(agent.id, month),
  });
});
