import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { acceptPhone } from "@/lib/phone";
import { signInWithPhone } from "@/lib/auth";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const body = parseBody(
    z.object({
      phone: z.string().min(1),
      code: z.string().optional(),
      name: z.string().min(1).max(80).optional(),
    }),
    await readJson(req),
  );
  return json(await signInWithPhone(acceptPhone(body.phone), body.name));
});
