import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseEarningsMonth } from "@/lib/agentEarnings";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing agent id", "VALIDATION_ERROR", 400);
  const body = parseBody(
    z.object({
      month: z.string(),
      amount: z.number().int().positive(),
      reference: z.string().trim().min(2).max(80),
    }),
    await readJson(req),
  );
  const { month } = parseEarningsMonth(body.month);
  const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
  if (!agent) throw new AppError("Agent not found", "NOT_FOUND", 404);

  const existing = await prisma.agentPayout.findUnique({
    where: { agentId_month: { agentId: id, month } },
  });
  if (existing) {
    throw new AppError("This month was already marked paid", "ALREADY_PAID", 409);
  }

  const payout = await prisma.agentPayout.create({
    data: {
      agentId: id,
      month,
      amount: body.amount,
      reference: body.reference,
    },
  });
  return json({
    payout: {
      id: payout.id,
      month: payout.month,
      amountKobo: payout.amount,
      reference: payout.reference,
      paidAt: payout.createdAt.toISOString(),
    },
  });
});
