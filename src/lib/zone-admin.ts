import { z } from "zod";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { invalidateZoneCache, type PricingZone } from "@/lib/zones";

export const SLUG_PATTERN = /^[A-Z0-9]{2,6}$/;
const NAME_MAX = 40;
const RADIUS_MIN_KM = 1;
const RADIUS_MAX_KM = 8;
const LAT_MIN = 4;
const LAT_MAX = 14;
const LNG_MIN = 2;
const LNG_MAX = 15;

export const createZoneSchema = z.object({
  slug: z.string().min(2).max(6),
  name: z.string().trim().min(2).max(NAME_MAX),
  centerLat: z.number().finite().min(LAT_MIN).max(LAT_MAX),
  centerLng: z.number().finite().min(LNG_MIN).max(LNG_MAX),
  radiusKm: z.number().finite().min(RADIUS_MIN_KM).max(RADIUS_MAX_KM),
  active: z.boolean().optional(),
  adjacentSlugs: z.array(z.string()).optional(),
});

export const updateZoneSchema = z
  .object({
    name: z.string().trim().min(2).max(NAME_MAX).optional(),
    centerLat: z.number().finite().min(LAT_MIN).max(LAT_MAX).optional(),
    centerLng: z.number().finite().min(LNG_MIN).max(LNG_MAX).optional(),
    radiusKm: z.number().finite().min(RADIUS_MIN_KM).max(RADIUS_MAX_KM).optional(),
    active: z.boolean().optional(),
    adjacentSlugs: z.array(z.string()).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;

function normalizeSlug(raw: string): string {
  return raw.trim().toUpperCase();
}

function assertSlug(raw: string): string {
  const slug = normalizeSlug(raw);
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError(
      "Slug must be 2–6 letters or numbers (e.g. YAB)",
      "VALIDATION_ERROR",
      400,
    );
  }
  return slug;
}

function present(row: {
  slug: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  active: boolean;
  adjacentSlugs: string[];
}): PricingZone {
  return {
    slug: row.slug,
    name: row.name,
    centerLat: row.centerLat,
    centerLng: row.centerLng,
    radiusKm: row.radiusKm,
    active: row.active,
    adjacentSlugs: [...row.adjacentSlugs],
  };
}

async function rewriteAdjacency(slug: string, adjacent: string[]): Promise<void> {
  const unique = Array.from(
    new Set(
      adjacent
        .map((item) => normalizeSlug(item))
        .filter((item) => item && item !== slug),
    ),
  );
  const known = await prisma.pricingZone.findMany({
    select: { slug: true, adjacentSlugs: true },
  });
  const knownSet = new Set(known.map((zone) => zone.slug));
  const unknown = unique.filter((item) => !knownSet.has(item));
  if (unknown.length > 0) {
    throw new AppError(
      `Unknown adjacent zone: ${unknown.join(", ")}`,
      "VALIDATION_ERROR",
      400,
    );
  }

  await prisma.pricingZone.update({
    where: { slug },
    data: { adjacentSlugs: unique },
  });

  await Promise.all(
    known
      .filter((zone) => zone.slug !== slug)
      .map((zone) => {
        const has = zone.adjacentSlugs.includes(slug);
        const should = unique.includes(zone.slug);
        if (has === should) return Promise.resolve();
        const adjacentSlugs = should
          ? [...zone.adjacentSlugs, slug]
          : zone.adjacentSlugs.filter((item) => item !== slug);
        return prisma.pricingZone.update({
          where: { slug: zone.slug },
          data: { adjacentSlugs },
        });
      }),
  );
}

export async function createZone(input: CreateZoneInput): Promise<PricingZone> {
  const slug = assertSlug(input.slug);
  const exists = await prisma.pricingZone.findUnique({ where: { slug } });
  if (exists) {
    throw new AppError("That slug is already in use", "ZONE_SLUG_TAKEN", 409);
  }

  const created = await prisma.pricingZone.create({
    data: {
      slug,
      name: input.name.trim(),
      centerLat: input.centerLat,
      centerLng: input.centerLng,
      radiusKm: input.radiusKm,
      active: input.active ?? false,
      adjacentSlugs: [],
    },
  });

  if (input.adjacentSlugs?.length) {
    await rewriteAdjacency(slug, input.adjacentSlugs);
  }

  invalidateZoneCache();
  const row = await prisma.pricingZone.findUniqueOrThrow({ where: { slug: created.slug } });
  return present(row);
}

export async function updateZone(
  slugRaw: string,
  input: UpdateZoneInput,
): Promise<PricingZone> {
  const slug = assertSlug(slugRaw);
  const current = await prisma.pricingZone.findUnique({ where: { slug } });
  if (!current) throw new AppError("Zone not found", "NOT_FOUND", 404);

  if (current.active && input.active === false) {
    const liveCount = await prisma.pricingZone.count({ where: { active: true } });
    if (liveCount <= 1) {
      throw new AppError(
        "Keep at least one live zone",
        "LAST_LIVE_ZONE",
        409,
      );
    }
  }

  await prisma.pricingZone.update({
    where: { slug },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.centerLat !== undefined ? { centerLat: input.centerLat } : {}),
      ...(input.centerLng !== undefined ? { centerLng: input.centerLng } : {}),
      ...(input.radiusKm !== undefined ? { radiusKm: input.radiusKm } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });

  if (input.adjacentSlugs) {
    await rewriteAdjacency(slug, input.adjacentSlugs);
  }

  invalidateZoneCache();
  const row = await prisma.pricingZone.findUniqueOrThrow({ where: { slug } });
  return present(row);
}

export async function deleteZone(slugRaw: string): Promise<void> {
  const slug = assertSlug(slugRaw);
  const current = await prisma.pricingZone.findUnique({ where: { slug } });
  if (!current) throw new AppError("Zone not found", "NOT_FOUND", 404);

  const remaining = await prisma.pricingZone.count();
  if (remaining <= 1) {
    throw new AppError("Keep at least one delivery zone", "LAST_ZONE", 409);
  }

  const [riders, orders] = await Promise.all([
    prisma.rider.count({ where: { zoneSlug: slug } }),
    prisma.order.count({ where: { zoneSlug: slug } }),
  ]);
  if (riders > 0 || orders > 0) {
    throw new AppError(
      "Move riders and past orders off this zone before removing it.",
      "ZONE_IN_USE",
      409,
    );
  }

  const others = await prisma.pricingZone.findMany({
    where: { slug: { not: slug } },
    select: { slug: true, adjacentSlugs: true },
  });
  await Promise.all(
    others
      .filter((zone) => zone.adjacentSlugs.includes(slug))
      .map((zone) =>
        prisma.pricingZone.update({
          where: { slug: zone.slug },
          data: { adjacentSlugs: zone.adjacentSlugs.filter((item) => item !== slug) },
        }),
      ),
  );

  await prisma.pricingZone.delete({ where: { slug } });
  invalidateZoneCache();
}
