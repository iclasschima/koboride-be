import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer", "rider", "admin"]);
  const { endpoint } = parseBody(
    z.object({ endpoint: z.string().url() }),
    await readJson(req),
  );

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.sub },
  });

  return json({ ok: true });
});
