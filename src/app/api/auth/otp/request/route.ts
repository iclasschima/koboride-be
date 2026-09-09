import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { acceptPhone } from "@/lib/phone";
import { signInWithPhone } from "@/lib/auth";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { phone: raw } = parseBody(
    z.object({ phone: z.string().min(1) }),
    await readJson(req),
  );
  return json(await signInWithPhone(acceptPhone(raw)));
});
