import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { normalizePhone } from "@/lib/phone";
import { verifyOtp } from "@/lib/otp";
import { signInCustomer } from "@/lib/auth";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const body = parseBody(
    z.object({
      phone: z.string().min(1),
      code: z.string().min(1),
      name: z.string().min(1).max(80).optional(),
    }),
    await readJson(req),
  );
  const phone = normalizePhone(body.phone);
  if (!/^\d{4}$/.test(body.code)) {
    throw new AppError("Enter the 4-digit code we sent", "VALIDATION_ERROR", 400);
  }
  await verifyOtp(phone, body.code);
  return json(await signInCustomer(phone, body.name));
});
