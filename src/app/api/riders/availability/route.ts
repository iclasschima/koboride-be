import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { rider } = await requireRider(req);
  const { online } = parseBody(z.object({ online: z.boolean() }), await readJson(req));
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { availability: online ? "ONLINE" : "OFFLINE" },
    select: { id: true, name: true, phone: true, availability: true },
  });
  return json({ rider: { ...updated, online: updated.availability === "ONLINE" } });
});
