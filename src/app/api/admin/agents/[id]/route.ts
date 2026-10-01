import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

export const PATCH = api(async (req, ctx) => {
  await requireAdmin(req, "agents");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing agent id", "VALIDATION_ERROR", 400);
  const body = parseBody(z.object({ active: z.boolean() }), await readJson(req));
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) throw new AppError("Agent not found", "NOT_FOUND", 404);
  const updated = await prisma.agent.update({
    where: { id },
    data: { active: body.active },
  });
  return json({
    agent: { id: updated.id, name: updated.name, phone: updated.phone, active: updated.active },
  });
});
