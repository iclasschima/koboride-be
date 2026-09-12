import { z } from "zod";
import type { PushRole } from "@prisma/client";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().nullable().optional(),
});

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer", "rider", "admin"]);
  const body = parseBody(bodySchema, await readJson(req));
  const role = user.role as PushRole;

  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId: user.sub,
      role,
      endpoint: body.endpoint,
      keys: body.keys,
    },
    update: {
      userId: user.sub,
      role,
      keys: body.keys,
    },
  });

  return json({ ok: true, id: row.id }, 201);
});
