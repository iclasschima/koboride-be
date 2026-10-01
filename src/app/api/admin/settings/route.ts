import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";
import {
  getPlatformSettings,
  platformSettingsPatchSchema,
  updatePlatformSettings,
} from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireAdmin(req, "settings");
  return json(await withRidersOnline(await getPlatformSettings()));
});

export const PATCH = api(async (req) => {
  await requireAdmin(req, "settings");
  const body = parseBody(platformSettingsPatchSchema, await readJson(req));
  return json(await withRidersOnline(await updatePlatformSettings(body)));
});

async function withRidersOnline<T extends object>(settings: T) {
  const ridersOnline = await prisma.rider.count({ where: { approved: true, availability: "ONLINE" } });
  return { ...settings, ridersOnline };
}
