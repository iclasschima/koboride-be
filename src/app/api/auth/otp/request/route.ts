import { z } from "zod";
import { requireRiderAccount } from "@/lib/auth";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { normalizePhone } from "@/lib/phone";
import { issueOtp } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const body = parseBody(
    z.object({
      phone: z.string().min(1),
      role: z.enum(["rider"]).optional(),
    }),
    await readJson(req),
  );
  const phone = normalizePhone(body.phone);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`otp:${phone}`, 5, 15 * 60 * 1000, "Too many OTP requests for this number.");
  rateLimit(`otp-ip:${ip}`, 20, 15 * 60 * 1000, "Too many OTP requests from this network.");
  if (body.role === "rider") await requireRiderAccount(phone);
  return json(await issueOtp(phone));
});
