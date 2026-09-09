import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";

/** Normalize NG numbers to E.164 (+234…). */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }
  if (digits.length === 10) return `+234${digits}`;
  throw new AppError("Enter a valid Nigerian phone number", "INVALID_PHONE", 400);
}

/** When OTP is skipped, store whatever they typed. */
export function acceptPhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new AppError("Enter a phone number", "INVALID_PHONE", 400);
  if (config.otpSkip && !config.isProd) return trimmed;
  return normalizePhone(trimmed);
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
}
