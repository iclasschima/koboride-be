import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";

export const OPTIONS = () => options();

function asOpsUser(rider: {
  id: string;
  name: string;
  phone: string;
  approved: boolean;
  createdAt: Date;
}) {
  return {
    id: rider.id,
    role: "rider" as const,
    name: rider.name,
    phone: rider.phone,
    approved: rider.approved,
    createdAt: rider.createdAt.toISOString(),
  };
}

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const riders = await prisma.rider.findMany({ orderBy: { createdAt: "desc" } });
  return json({ riders: riders.map(asOpsUser) });
});

export const POST = api(async (req) => {
  requireUser(req, ["admin"]);
  const body = parseBody(
    z.object({ phone: z.string().min(10), name: z.string().min(2).max(80) }),
    await readJson(req),
  );
  const phone = normalizePhone(body.phone);
  const rider = await prisma.rider.upsert({
    where: { phone },
    create: { phone, name: body.name.trim(), approved: true, availability: "OFFLINE" },
    update: { name: body.name.trim(), approved: true },
  });
  return json({ rider: asOpsUser(rider) }, 201);
});
