import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { acceptPhone } from "@/lib/phone";
import { verifyOtp } from "@/lib/otp";
import { signInWithPhone } from "@/lib/auth";
import { config } from "@/lib/config";

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
  const phone = acceptPhone(body.phone);

  if (!config.otpSkip) {
    if (!body.code || !/^\d{4,6}$/.test(body.code)) {
      throw new AppError("Enter the code we sent", "VALIDATION_ERROR", 400);
    }
    await verifyOtp(phone, body.code);
  }

  return json(await signInWithPhone(phone, body.name));
});
