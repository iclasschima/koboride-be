import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireAdmin } from "@/lib/adminAuth";
import { getPricingZones } from "@/lib/zones";
import { createZone, createZoneSchema } from "@/lib/zone-admin";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "settings");
  return json({ zones: await getPricingZones() });
});

export const POST = api(async (req) => {
  await requireAdmin(req, "settings");
  const body = parseBody(createZoneSchema, await readJson(req));
  return json({ zone: await createZone(body) }, 201);
});
