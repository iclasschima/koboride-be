import { AppError } from "@/lib/errors";

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

/** Every usual NG writing of the same line: 080…, 803…, 234…, +234… */
export function phoneLookupKeys(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) throw new AppError("Enter a phone number", "INVALID_PHONE", 400);
  const keys = new Set<string>([trimmed]);
  const digits = trimmed.replace(/\D/g, "");
  let nsn = "";
  if (digits.startsWith("234") && digits.length === 13) nsn = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 11) nsn = digits.slice(1);
  else if (digits.length === 10) nsn = digits;
  if (nsn) {
    keys.add(nsn);
    keys.add(`0${nsn}`);
    keys.add(`234${nsn}`);
    keys.add(`+234${nsn}`);
  }
  return Array.from(keys);
}

export function samePhone(a: string, b: string): boolean {
  try {
    return normalizePhone(a) === normalizePhone(b);
  } catch {
    return a.trim() === b.trim();
  }
}

export function preferredPhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new AppError("Enter a phone number", "INVALID_PHONE", 400);
  try {
    return normalizePhone(trimmed);
  } catch {
    return trimmed;
  }
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
}
