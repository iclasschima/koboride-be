import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { presentAdmin, requireSuperAdmin } from "@/lib/adminAuth";
import { setAdminPin, setPinSchema } from "@/lib/adminTeam";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { admin } = await requireSuperAdmin(req);
  rateLimit(`admin-set-pin:${admin.id}`, 8, 15 * 60 * 1000, "Too many tries. Try again in 15 minutes.");
  const body = parseBody(setPinSchema, await readJson(req));
  return json({ admin: presentAdmin(await setAdminPin(admin, body)) });
});
