import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { acceptPhone } from "@/lib/phone";
import { issueOtp } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import { signInWithPhone } from "@/lib/auth";
import { config } from "@/lib/config";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { phone: raw } = parseBody(
    z.object({ phone: z.string().min(1) }),
    await readJson(req),
  );
  const phone = acceptPhone(raw);

  if (config.otpSkip && !config.isProd) {
    return json(await signInWithPhone(phone));
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`otp:${phone}`, 5, 15 * 60 * 1000, "Too many OTP requests for this number.");
  rateLimit(`otp-ip:${ip}`, 20, 15 * 60 * 1000, "Too many OTP requests from this network.");
  return json(await issueOtp(phone));
});
