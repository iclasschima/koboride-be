import { api, json, options } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAgent(req);
  const zones = await prisma.pricingZone.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { slug: true, name: true },
  });
  return json({
    zones: zones.map((zone) => ({ id: zone.slug, name: zone.name })),
  });
});
