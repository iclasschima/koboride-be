import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { getPricingZones } from "@/lib/zones";
import { createZone, createZoneSchema } from "@/lib/zone-admin";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  return json({ zones: await getPricingZones() });
});

export const POST = api(async (req) => {
  requireUser(req, ["admin"]);
  const body = parseBody(createZoneSchema, await readJson(req));
  return json({ zone: await createZone(body) }, 201);
});
