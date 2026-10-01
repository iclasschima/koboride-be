import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "agents");
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { riders: true } } },
  });
  return json({
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      phone: agent.phone,
      active: agent.active,
      createdAt: agent.createdAt.toISOString(),
      riderCount: agent._count.riders,
    })),
  });
});

export const POST = api(async (req) => {
  await requireAdmin(req, "agents");
  const body = parseBody(
    z.object({
      name: z.string().trim().min(2).max(80),
      phone: z.string().min(10),
    }),
    await readJson(req),
  );
  const phone = normalizePhone(body.phone);
  const existing = await prisma.agent.findFirst({
    where: { phone: { in: phoneLookupKeys(phone) } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("An agent with this phone already exists", "DUPLICATE_AGENT", 409);
  }
  const agent = await prisma.agent.create({
    data: { name: body.name.trim(), phone, active: true },
  });
  return json(
    { agent: { id: agent.id, name: agent.name, phone: agent.phone, active: agent.active } },
    201,
  );
});
