import { lagosParts } from "@/lib/payoutMath";

export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ShopHours = { opensAt: string; closesAt: string };

export function shopHours(merchant: { opensAt: string | null; closesAt: string | null }): ShopHours | null {
  return merchant.opensAt && merchant.closesAt ? { opensAt: merchant.opensAt, closesAt: merchant.closesAt } : null;
}

function minutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

/** No hours means always open. Closing at or before opening runs past midnight. */
export function shopOpenAt(hours: ShopHours | null, at: Date = new Date()): boolean {
  if (!hours) return true;
  const { hour, minute } = lagosParts(at);
  const now = hour * 60 + minute;
  const opens = minutes(hours.opensAt);
  const closes = minutes(hours.closesAt);
  return opens < closes ? now >= opens && now < closes : now >= opens || now < closes;
}

/** "21:30" → "9:30 pm" */
export function formatClock(clock: string): string {
  const [hour, minute] = clock.split(":").map(Number);
  const suffix = hour < 12 ? "am" : "pm";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
