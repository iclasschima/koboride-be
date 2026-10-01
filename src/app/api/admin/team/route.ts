import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { confirmPin, presentAdmin, requireSuperAdmin } from "@/lib/adminAuth";
import { createStaff, createStaffSchema } from "@/lib/adminTeam";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  await requireSuperAdmin(req);
  const admins = await prisma.admin.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  return json({ admins: admins.map(presentAdmin) });
});

export const POST = api(async (req) => {
  const { admin } = await requireSuperAdmin(req);
  const body = parseBody(createStaffSchema, await readJson(req));
  await confirmPin(admin, body.pin);
  return json({ admin: presentAdmin(await createStaff(body)) }, 201);
});
