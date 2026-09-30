import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export const POST = api(async (req) => {
  const { rider } = await requireRider(req);
  const { lat, lng } = parseBody(pointSchema, await readJson(req));
  await prisma.rider.update({
    where: { id: rider.id },
    data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() },
  });
  return json({ ok: true });
});
