import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";

export const MAX_ACTIVE_ORDERS_KEY = "maxActiveOrders";
export const PLATFORM_CUT_KEY = "platformCutPercent";
export const CLIENT_REFRESH_NONCE_KEY = "clientRefreshNonce";
export const BASE_FEE_KEY = "baseFeeNgn";
export const PER_KM_FEE_KEY = "perKmFeeNgn";
export const MIN_FARE_KEY = "minFareNgn";
export const ONLINE_DISCOUNT_KEY = "onlinePaymentDiscountNgn";

const MAX_ACTIVE_ORDERS_CEILING = 50;
const FARE_AMOUNT_MAX = 50_000;
const ONLINE_DISCOUNT_MAX = 5_000;

export type PlatformSettings = {
  maxActiveOrders: number;
  platformCutPercent: number;
  clientRefreshNonce: number;
  baseFeeNgn: number;
  perKmFeeNgn: number;
  minFareNgn: number;
  onlinePaymentDiscountNgn: number;
};

export type ClientAppStatus = {
  nonce: number;
  paystackEnabled: boolean;
};

const CLIENT_REFRESH_HEADER = "X-Kobo-Refresh";
let refreshCache: { at: number; nonce: number } | null = null;

const SETTINGS_KEYS = [
  MAX_ACTIVE_ORDERS_KEY,
  PLATFORM_CUT_KEY,
  CLIENT_REFRESH_NONCE_KEY,
  BASE_FEE_KEY,
  PER_KM_FEE_KEY,
  MIN_FARE_KEY,
  ONLINE_DISCOUNT_KEY,
] as const;

function invalidateClientRefreshCache() {
  refreshCache = null;
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

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...SETTINGS_KEYS] } },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    maxActiveOrders: parsePositiveInt(map[MAX_ACTIVE_ORDERS_KEY], config.maxActiveOrders),
    platformCutPercent: parseIntInRange(map[PLATFORM_CUT_KEY], config.platformCutPercent, 0, 50),
    clientRefreshNonce: parseIntInRange(map[CLIENT_REFRESH_NONCE_KEY], 0, 0, Number.MAX_SAFE_INTEGER),
    baseFeeNgn: parseIntInRange(map[BASE_FEE_KEY], config.baseFeeNgn, 0, FARE_AMOUNT_MAX),
    perKmFeeNgn: parseIntInRange(map[PER_KM_FEE_KEY], config.perKmFeeNgn, 0, FARE_AMOUNT_MAX),
    minFareNgn: parseIntInRange(map[MIN_FARE_KEY], config.minFareNgn, 0, FARE_AMOUNT_MAX),
    onlinePaymentDiscountNgn: parseIntInRange(
      map[ONLINE_DISCOUNT_KEY],
      config.onlinePaymentDiscountNgn,
      0,
      ONLINE_DISCOUNT_MAX,
    ),
  };
}

export async function getClientAppStatus(): Promise<ClientAppStatus> {
  const settings = await getPlatformSettings();
  return {
    nonce: settings.clientRefreshNonce,
    paystackEnabled: Boolean(config.paystackSecretKey.trim() && config.paystackPublicKey.trim()),
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

export async function updatePlatformSettings(
  input: Partial<PlatformSettings> & { bumpClientRefresh?: boolean },
): Promise<PlatformSettings> {
  const hasFareUpdate =
    input.baseFeeNgn !== undefined ||
    input.perKmFeeNgn !== undefined ||
    input.minFareNgn !== undefined ||
    input.onlinePaymentDiscountNgn !== undefined;

  if (
    input.maxActiveOrders === undefined &&
    input.platformCutPercent === undefined &&
    !hasFareUpdate &&
    input.bumpClientRefresh !== true
  ) {
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

  await Promise.all([
    upsertSetting(MAX_ACTIVE_ORDERS_KEY, String(next.maxActiveOrders)),
    upsertSetting(PLATFORM_CUT_KEY, String(next.platformCutPercent)),
    upsertSetting(CLIENT_REFRESH_NONCE_KEY, String(next.clientRefreshNonce)),
    upsertSetting(BASE_FEE_KEY, String(next.baseFeeNgn)),
    upsertSetting(PER_KM_FEE_KEY, String(next.perKmFeeNgn)),
    upsertSetting(MIN_FARE_KEY, String(next.minFareNgn)),
    upsertSetting(ONLINE_DISCOUNT_KEY, String(next.onlinePaymentDiscountNgn)),
  ]);
  if (input.bumpClientRefresh) invalidateClientRefreshCache();
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
    bumpClientRefresh: z.literal(true).optional(),
  })
  .refine(
    (body) =>
      body.maxActiveOrders !== undefined ||
      body.platformCutPercent !== undefined ||
      body.baseFeeNgn !== undefined ||
      body.perKmFeeNgn !== undefined ||
      body.minFareNgn !== undefined ||
      body.onlinePaymentDiscountNgn !== undefined ||
      body.bumpClientRefresh === true,
    { message: "Nothing to update" },
  );
