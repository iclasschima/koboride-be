import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { signInCustomer } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

/** Alias of POST /api/auth/customer/login */
export const POST = api(async (req) => {
  const body = parseBody(
    z.object({
      phone: z.string().min(1),
      code: z.string().optional(),
      name: z.string().min(1).max(80).optional(),
    }),
    await readJson(req),
  );
  rateLimit(`customer-login:${body.phone.trim()}`, 20, 15 * 60 * 1000);
  return json(await signInCustomer(body.phone, body.name));
});
