import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";
import { activeZones, getPricingZones, type PricingZone } from "@/lib/zones";

export const MAX_ACTIVE_ORDERS_KEY = "maxActiveOrders";
export const PLATFORM_CUT_KEY = "platformCutPercent";
export const CLIENT_REFRESH_NONCE_KEY = "clientRefreshNonce";
export const BASE_FEE_KEY = "baseFeeNgn";
export const PER_KM_FEE_KEY = "perKmFeeNgn";
export const MIN_FARE_KEY = "minFareNgn";
export const ONLINE_DISCOUNT_KEY = "onlinePaymentDiscountNgn";
export const STILL_LOOKING_KEY = "stillLookingAfterMinutes";
export const RESCHEDULE_DELAY_KEY = "rescheduleDelayMinutes";

const MAX_ACTIVE_ORDERS_CEILING = 50;
const FARE_AMOUNT_MAX = 50_000;
const ONLINE_DISCOUNT_MAX = 5_000;
const STILL_LOOKING_MINUTES_MAX = 120;
const RESCHEDULE_DELAY_MINUTES_MAX = 240;

export type PlatformSettings = {
  maxActiveOrders: number;
  platformCutPercent: number;
  clientRefreshNonce: number;
  baseFeeNgn: number;
  perKmFeeNgn: number;
  minFareNgn: number;
  onlinePaymentDiscountNgn: number;
  /** Minutes searching with no rider before we offer a cheaper retry. */
  stillLookingAfterMinutes: number;
  /** Minutes to pause search when the customer takes that retry. */
  rescheduleDelayMinutes: number;
};

export type ClientAppStatus = {
  nonce: number;
  paystackEnabled: boolean;
  zones: PricingZone[];
  maxDeliveryDistanceKm: number;
};

const CLIENT_REFRESH_HEADER = "X-Kobo-Refresh";
let refreshCache: { at: number; nonce: number } | null = null;
let settingsCache: { at: number; value: PlatformSettings } | null = null;

const SETTINGS_KEYS = [
  MAX_ACTIVE_ORDERS_KEY,
  PLATFORM_CUT_KEY,
  CLIENT_REFRESH_NONCE_KEY,
  BASE_FEE_KEY,
  PER_KM_FEE_KEY,
  MIN_FARE_KEY,
  ONLINE_DISCOUNT_KEY,
  STILL_LOOKING_KEY,
  RESCHEDULE_DELAY_KEY,
] as const;

export function minutesToMs(minutes: number): number {
  return Math.max(0, minutes) * 60_000;
}

function minutesFromMs(ms: number, fallback: number): number {
  const n = Math.round(ms / 60_000);
  return n >= 1 ? n : fallback;
}

function invalidateClientRefreshCache() {
  refreshCache = null;
}

function invalidateSettingsCache() {
  settingsCache = null;
  invalidateClientRefreshCache();
}

export async function attachClientRefreshHeader(res: NextResponse): Promise<void> {
  const now = Date.now();
  if (!refreshCache || now - refreshCache.at > 2_000) {
    const status = await getClientAppStatus();
    refreshCache = { at: now, nonce: status.nonce };
  }
  res.headers.set(CLIENT_REFRESH_HEADER, String(refreshCache.nonce));
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

function parseIntInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function defaultPlatformSettings(): PlatformSettings {
  return {
    maxActiveOrders: config.maxActiveOrders,
    platformCutPercent: config.platformCutPercent,
    clientRefreshNonce: 0,
    baseFeeNgn: config.baseFeeNgn,
    perKmFeeNgn: config.perKmFeeNgn,
    minFareNgn: config.minFareNgn,
    onlinePaymentDiscountNgn: config.onlinePaymentDiscountNgn,
    stillLookingAfterMinutes: minutesFromMs(config.stillLookingAfterMs, 8),
    rescheduleDelayMinutes: minutesFromMs(config.rescheduleDelayMs, 30),
  };
}

export function cachedPlatformSettings(): PlatformSettings {
  return settingsCache?.value ?? defaultPlatformSettings();
}

function settingsFromMap(map: Record<string, string | undefined>): PlatformSettings {
  const fallback = defaultPlatformSettings();
  return {
    maxActiveOrders: parsePositiveInt(map[MAX_ACTIVE_ORDERS_KEY], fallback.maxActiveOrders),
    platformCutPercent: parseIntInRange(map[PLATFORM_CUT_KEY], fallback.platformCutPercent, 0, 50),
    clientRefreshNonce: parseIntInRange(
      map[CLIENT_REFRESH_NONCE_KEY],
      fallback.clientRefreshNonce,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    baseFeeNgn: parseIntInRange(map[BASE_FEE_KEY], fallback.baseFeeNgn, 0, FARE_AMOUNT_MAX),
    perKmFeeNgn: parseIntInRange(map[PER_KM_FEE_KEY], fallback.perKmFeeNgn, 0, FARE_AMOUNT_MAX),
    minFareNgn: parseIntInRange(map[MIN_FARE_KEY], fallback.minFareNgn, 0, FARE_AMOUNT_MAX),
    onlinePaymentDiscountNgn: parseIntInRange(
      map[ONLINE_DISCOUNT_KEY],
      fallback.onlinePaymentDiscountNgn,
      0,
      ONLINE_DISCOUNT_MAX,
    ),
    stillLookingAfterMinutes: parseIntInRange(
      map[STILL_LOOKING_KEY],
      fallback.stillLookingAfterMinutes,
      1,
      STILL_LOOKING_MINUTES_MAX,
    ),
    rescheduleDelayMinutes: parseIntInRange(
      map[RESCHEDULE_DELAY_KEY],
      fallback.rescheduleDelayMinutes,
      1,
      RESCHEDULE_DELAY_MINUTES_MAX,
    ),
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < 2_000) return settingsCache.value;
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...SETTINGS_KEYS] } },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const value = settingsFromMap(map);
  settingsCache = { at: now, value };
  return value;
}

export async function getClientAppStatus(): Promise<ClientAppStatus> {
  const [settings] = await Promise.all([getPlatformSettings(), getPricingZones()]);
  return {
    nonce: settings.clientRefreshNonce,
    paystackEnabled: Boolean(config.paystackSecretKey.trim() && config.paystackPublicKey.trim()),
    zones: activeZones(),
    maxDeliveryDistanceKm: config.maxDeliveryDistanceKm,
  };
}

export async function getMaxActiveOrders(): Promise<number> {
  const settings = await getPlatformSettings();
  return settings.maxActiveOrders;
}

export async function getPlatformCutPercent(): Promise<number> {
  const settings = await getPlatformSettings();
  return settings.platformCutPercent;
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

function assertFareAmount(label: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new AppError(`${label} must be between 0 and ${max}`, "VALIDATION_ERROR", 400);
  }
}

function hasSettingsPatch(
  input: Partial<PlatformSettings> & { bumpClientRefresh?: boolean },
): boolean {
  return (
    input.maxActiveOrders !== undefined ||
    input.platformCutPercent !== undefined ||
    input.baseFeeNgn !== undefined ||
    input.perKmFeeNgn !== undefined ||
    input.minFareNgn !== undefined ||
    input.onlinePaymentDiscountNgn !== undefined ||
    input.stillLookingAfterMinutes !== undefined ||
    input.rescheduleDelayMinutes !== undefined ||
    input.bumpClientRefresh === true
  );
}

export async function updatePlatformSettings(
  input: Partial<PlatformSettings> & { bumpClientRefresh?: boolean },
): Promise<PlatformSettings> {
  if (!hasSettingsPatch(input)) {
    throw new AppError("Nothing to update", "VALIDATION_ERROR", 400);
  }

  const current = await getPlatformSettings();
  const next: PlatformSettings = {
    maxActiveOrders: input.maxActiveOrders ?? current.maxActiveOrders,
    platformCutPercent: input.platformCutPercent ?? current.platformCutPercent,
    clientRefreshNonce: input.bumpClientRefresh
      ? current.clientRefreshNonce + 1
      : current.clientRefreshNonce,
    baseFeeNgn: input.baseFeeNgn ?? current.baseFeeNgn,
    perKmFeeNgn: input.perKmFeeNgn ?? current.perKmFeeNgn,
    minFareNgn: input.minFareNgn ?? current.minFareNgn,
    onlinePaymentDiscountNgn:
      input.onlinePaymentDiscountNgn ?? current.onlinePaymentDiscountNgn,
    stillLookingAfterMinutes:
      input.stillLookingAfterMinutes ?? current.stillLookingAfterMinutes,
    rescheduleDelayMinutes:
      input.rescheduleDelayMinutes ?? current.rescheduleDelayMinutes,
  };

  if (
    !Number.isInteger(next.maxActiveOrders) ||
    next.maxActiveOrders < 1 ||
    next.maxActiveOrders > MAX_ACTIVE_ORDERS_CEILING
  ) {
    throw new AppError(
      `Live order cap must be between 1 and ${MAX_ACTIVE_ORDERS_CEILING}`,
      "VALIDATION_ERROR",
      400,
    );
  }
  if (
    !Number.isInteger(next.platformCutPercent) ||
    next.platformCutPercent < 0 ||
    next.platformCutPercent > 50
  ) {
    throw new AppError("Platform cut must be between 0 and 50 percent", "VALIDATION_ERROR", 400);
  }
  assertFareAmount("Base fare", next.baseFeeNgn, FARE_AMOUNT_MAX);
  assertFareAmount("Per-km rate", next.perKmFeeNgn, FARE_AMOUNT_MAX);
  assertFareAmount("Minimum fare", next.minFareNgn, FARE_AMOUNT_MAX);
  assertFareAmount("Online payment discount", next.onlinePaymentDiscountNgn, ONLINE_DISCOUNT_MAX);
  if (
    !Number.isInteger(next.stillLookingAfterMinutes) ||
    next.stillLookingAfterMinutes < 1 ||
    next.stillLookingAfterMinutes > STILL_LOOKING_MINUTES_MAX
  ) {
    throw new AppError(
      `Propose-discount wait must be between 1 and ${STILL_LOOKING_MINUTES_MAX} minutes`,
      "VALIDATION_ERROR",
      400,
    );
  }
  if (
    !Number.isInteger(next.rescheduleDelayMinutes) ||
    next.rescheduleDelayMinutes < 1 ||
    next.rescheduleDelayMinutes > RESCHEDULE_DELAY_MINUTES_MAX
  ) {
    throw new AppError(
      `Retry wait must be between 1 and ${RESCHEDULE_DELAY_MINUTES_MAX} minutes`,
      "VALIDATION_ERROR",
      400,
    );
  }

  await Promise.all([
    upsertSetting(MAX_ACTIVE_ORDERS_KEY, String(next.maxActiveOrders)),
    upsertSetting(PLATFORM_CUT_KEY, String(next.platformCutPercent)),
    upsertSetting(CLIENT_REFRESH_NONCE_KEY, String(next.clientRefreshNonce)),
    upsertSetting(BASE_FEE_KEY, String(next.baseFeeNgn)),
    upsertSetting(PER_KM_FEE_KEY, String(next.perKmFeeNgn)),
    upsertSetting(MIN_FARE_KEY, String(next.minFareNgn)),
    upsertSetting(ONLINE_DISCOUNT_KEY, String(next.onlinePaymentDiscountNgn)),
    upsertSetting(STILL_LOOKING_KEY, String(next.stillLookingAfterMinutes)),
    upsertSetting(RESCHEDULE_DELAY_KEY, String(next.rescheduleDelayMinutes)),
  ]);
  invalidateSettingsCache();
  return getPlatformSettings();
}

export const platformSettingsPatchSchema = z
  .object({
    maxActiveOrders: z.number().int().min(1).max(MAX_ACTIVE_ORDERS_CEILING).optional(),
    platformCutPercent: z.number().int().min(0).max(50).optional(),
    baseFeeNgn: z.number().int().min(0).max(FARE_AMOUNT_MAX).optional(),
    perKmFeeNgn: z.number().int().min(0).max(FARE_AMOUNT_MAX).optional(),
    minFareNgn: z.number().int().min(0).max(FARE_AMOUNT_MAX).optional(),
    onlinePaymentDiscountNgn: z.number().int().min(0).max(ONLINE_DISCOUNT_MAX).optional(),
    stillLookingAfterMinutes: z.number().int().min(1).max(STILL_LOOKING_MINUTES_MAX).optional(),
    rescheduleDelayMinutes: z.number().int().min(1).max(RESCHEDULE_DELAY_MINUTES_MAX).optional(),
    bumpClientRefresh: z.literal(true).optional(),
  })
  .refine(hasSettingsPatch, { message: "Nothing to update" });
