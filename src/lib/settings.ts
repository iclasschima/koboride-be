import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { config } from "@/lib/config";

export const MAX_ACTIVE_ORDERS_KEY = "maxActiveOrders";
export const PLATFORM_CUT_KEY = "platformCutPercent";

const MAX_ACTIVE_ORDERS_CEILING = 50;

export type PlatformSettings = {
  maxActiveOrders: number;
  platformCutPercent: number;
};

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
    where: {
      key: { in: [MAX_ACTIVE_ORDERS_KEY, PLATFORM_CUT_KEY] },
    },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    maxActiveOrders: parsePositiveInt(map[MAX_ACTIVE_ORDERS_KEY], config.maxActiveOrders),
    platformCutPercent: parseIntInRange(map[PLATFORM_CUT_KEY], config.platformCutPercent, 0, 50),
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

export async function updatePlatformSettings(
  input: Partial<PlatformSettings>,
): Promise<PlatformSettings> {
  if (input.maxActiveOrders === undefined && input.platformCutPercent === undefined) {
    throw new AppError("Nothing to update", "VALIDATION_ERROR", 400);
  }

  const current = await getPlatformSettings();
  const next: PlatformSettings = {
    maxActiveOrders: input.maxActiveOrders ?? current.maxActiveOrders,
    platformCutPercent: input.platformCutPercent ?? current.platformCutPercent,
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

  await Promise.all([
    upsertSetting(MAX_ACTIVE_ORDERS_KEY, String(next.maxActiveOrders)),
    upsertSetting(PLATFORM_CUT_KEY, String(next.platformCutPercent)),
  ]);
  return getPlatformSettings();
}

export const platformSettingsPatchSchema = z
  .object({
    maxActiveOrders: z.number().int().min(1).max(MAX_ACTIVE_ORDERS_CEILING).optional(),
    platformCutPercent: z.number().int().min(0).max(50).optional(),
  })
  .refine(
    (body) => body.maxActiveOrders !== undefined || body.platformCutPercent !== undefined,
    { message: "Nothing to update" },
  );
