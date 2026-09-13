import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import {
  getPlatformSettings,
  platformSettingsPatchSchema,
  updatePlatformSettings,
} from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  return json(await getPlatformSettings());
});

export const PATCH = api(async (req) => {
  requireUser(req, ["admin"]);
  const body = parseBody(platformSettingsPatchSchema, await readJson(req));
  return json(await updatePlatformSettings(body));
});
