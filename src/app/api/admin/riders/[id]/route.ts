import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const PATCH = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const { approved } = parseBody(z.object({ approved: z.boolean() }), await readJson(req));
  const rider = await prisma.rider.findUnique({ where: { id } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);

  const updated = await prisma.rider.update({
    where: { id },
    data: { approved },
  });
  return json({
    rider: {
      id: updated.id,
      role: "rider" as const,
      name: updated.name,
      phone: updated.phone,
      approved: updated.approved,
      createdAt: updated.createdAt.toISOString(),
    },
  });
});
