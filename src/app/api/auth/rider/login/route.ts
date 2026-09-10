import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { signInRider } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { phone } = parseBody(
    z.object({ phone: z.string().min(1) }),
    await readJson(req),
  );
  rateLimit(`rider-login:${phone.trim()}`, 20, 15 * 60 * 1000);
  return json(await signInRider(phone));
});
