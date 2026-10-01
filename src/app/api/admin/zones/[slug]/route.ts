import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireAdmin } from "@/lib/adminAuth";
import { deleteZone, updateZone, updateZoneSchema } from "@/lib/zone-admin";

export const OPTIONS = () => options();

export const PATCH = api(async (req, ctx) => {
  await requireAdmin(req, "settings");
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing zone slug", "VALIDATION_ERROR", 400);
  const body = parseBody(updateZoneSchema, await readJson(req));
  return json({ zone: await updateZone(slug, body) });
});

export const DELETE = api(async (req, ctx) => {
  await requireAdmin(req, "settings");
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing zone slug", "VALIDATION_ERROR", 400);
  await deleteZone(slug);
  return json({ ok: true });
});
