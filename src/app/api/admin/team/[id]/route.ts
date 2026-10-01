import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { confirmPin, presentAdmin, requireSuperAdmin } from "@/lib/adminAuth";
import { updateStaff, updateStaffSchema } from "@/lib/adminTeam";

export const OPTIONS = () => options();

export const PATCH = api(async (req, ctx) => {
  const { admin } = await requireSuperAdmin(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing admin id", "VALIDATION_ERROR", 400);
  const body = parseBody(updateStaffSchema, await readJson(req));
  await confirmPin(admin, body.pin);
  return json({ admin: presentAdmin(await updateStaff(id, body)) });
});
