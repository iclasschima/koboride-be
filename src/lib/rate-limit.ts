import { AppError } from "@/lib/errors";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** True once `rateLimit(key, max, …)` would refuse, without counting this check. */
export function rateLimited(key: string, max: number): boolean {
  const existing = buckets.get(key);
  return Boolean(existing && existing.resetAt > Date.now() && existing.count >= max);
}

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  message = "Too many requests. Try again shortly.",
): void {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (existing.count >= max) {
    throw new AppError(message, "RATE_LIMITED", 429);
  }
  existing.count += 1;
}
