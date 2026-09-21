import { haversineKm } from "@/lib/distance";
import { prisma } from "@/lib/prisma";

export type PricingZone = {
  /** Short code for schema, logs, and admin. */
  slug: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  active: boolean;
  adjacentSlugs: string[];
};

/**
 * Neighborhood bicycle coverage. Completed Yaba orders (n=20) sat at
 * p95 1.7km / max 1.8km, so the live 4km Yaba circle is the proven
 * pickup/drop-off radius — not the 10km MAX_DELIVERY_DISTANCE_KM cap.
 */
const ZONE_RADIUS_KM = 4;
const ZONE_CACHE_MS = 2_000;

/** Seed / empty-table fallback. Live catalog is `PricingZone` in the DB. */
export const DEFAULT_PRICING_ZONES: PricingZone[] = [
  {
    slug: "YAB",
    name: "Yaba",
    centerLat: 6.5055,
    centerLng: 3.3795,
    radiusKm: ZONE_RADIUS_KM,
    active: true,
    adjacentSlugs: ["SRL", "GBG"],
  },
  {
    slug: "SRL",
    name: "Surulere",
    centerLat: 6.4965,
    centerLng: 3.354,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: ["YAB"],
  },
  {
    slug: "GBG",
    name: "Gbagada",
    centerLat: 6.551,
    centerLng: 3.389,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: ["YAB", "OJK"],
  },
  {
    slug: "IKJ",
    name: "Ikeja",
    centerLat: 6.6018,
    centerLng: 3.3515,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: ["OJK"],
  },
  {
    slug: "AJH",
    name: "Ajah",
    centerLat: 6.4698,
    centerLng: 3.5683,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: [],
  },
  {
    slug: "LK1",
    name: "Lekki Phase 1",
    centerLat: 6.4474,
    centerLng: 3.4721,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: [],
  },
  {
    slug: "OJK",
    name: "Ojota/Ketu",
    centerLat: 6.5865,
    centerLng: 3.3868,
    radiusKm: ZONE_RADIUS_KM,
    active: false,
    adjacentSlugs: ["GBG", "IKJ"],
  },
];

export const DEFAULT_ZONE_SLUG = "YAB";

let zoneCache: { at: number; value: PricingZone[] } | null = null;

export function invalidateZoneCache() {
  zoneCache = null;
}

export function cachedPricingZones(): PricingZone[] {
  return zoneCache?.value ?? DEFAULT_PRICING_ZONES;
}

function presentZone(row: {
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

export async function getPricingZones(): Promise<PricingZone[]> {
  const now = Date.now();
  if (zoneCache && now - zoneCache.at < ZONE_CACHE_MS) return zoneCache.value;

  let rows = await prisma.pricingZone.findMany({ orderBy: { name: "asc" } });
  if (rows.length === 0) {
    await prisma.pricingZone.createMany({
      data: DEFAULT_PRICING_ZONES.map((zone) => ({
        slug: zone.slug,
        name: zone.name,
        centerLat: zone.centerLat,
        centerLng: zone.centerLng,
        radiusKm: zone.radiusKm,
        active: zone.active,
        adjacentSlugs: [...zone.adjacentSlugs],
      })),
      skipDuplicates: true,
    });
    rows = await prisma.pricingZone.findMany({ orderBy: { name: "asc" } });
  }

  const value = rows.map(presentZone);
  zoneCache = { at: now, value };
  return value;
}

export function defaultZoneSlug(): string {
  const zones = cachedPricingZones();
  return (
    zones.find((zone) => zone.active)?.slug ??
    zones[0]?.slug ??
    DEFAULT_ZONE_SLUG
  );
}

export function zoneBySlug(slug: string | null | undefined): PricingZone | undefined {
  if (!slug) return undefined;
  const key = slug.trim().toUpperCase();
  return cachedPricingZones().find((zone) => zone.slug === key);
}

export function zoneName(slug: string | null | undefined): string {
  return zoneBySlug(slug)?.name ?? slug ?? "Unknown";
}

export function isKnownZoneSlug(slug: string): boolean {
  return Boolean(zoneBySlug(slug));
}

export function activeZones(): PricingZone[] {
  const catalog = cachedPricingZones();
  const live = catalog.filter((zone) => zone.active);
  if (live.length > 0) return live;
  const fallback = zoneBySlug(defaultZoneSlug());
  return fallback ? [fallback] : catalog.slice(0, 1);
}

export function isInZone(zone: PricingZone, lat: number, lng: number): boolean {
  return haversineKm(zone.centerLat, zone.centerLng, lat, lng) <= zone.radiusKm;
}

export function zonesContaining(
  lat: number,
  lng: number,
  zones: PricingZone[] = activeZones(),
): PricingZone[] {
  return zones.filter((zone) => isInZone(zone, lat, lng));
}

export function nearestZone(lat: number, lng: number, zones: PricingZone[]): PricingZone {
  return zones.reduce((best, zone) => {
    const bestKm = haversineKm(best.centerLat, best.centerLng, lat, lng);
    const nextKm = haversineKm(zone.centerLat, zone.centerLng, lat, lng);
    return nextKm < bestKm ? zone : best;
  });
}

/** Lagos State, padded so Ikorodu / Badagry / Epe still sit inside. */
export const LAGOS_BOUNDS = {
  south: 6.32,
  west: 2.7,
  north: 6.73,
  east: 4.36,
};

export function isInLagos(lat: number, lng: number): boolean {
  return (
    lat >= LAGOS_BOUNDS.south &&
    lat <= LAGOS_BOUNDS.north &&
    lng >= LAGOS_BOUNDS.west &&
    lng <= LAGOS_BOUNDS.east
  );
}

export function zoneNameForPoint(lat: number, lng: number): string {
  const hits = zonesContaining(lat, lng);
  if (hits.length === 0) return "Lagos";
  return nearestZone(lat, lng, hits).name;
}

export function zonesAreAdjacent(a: PricingZone, b: PricingZone): boolean {
  if (a.slug === b.slug) return true;
  return a.adjacentSlugs.includes(b.slug) || b.adjacentSlugs.includes(a.slug);
}

export type RouteZoneOk = { ok: true; zone: PricingZone };
export type RouteZoneErr = {
  ok: false;
  code: "OUTSIDE_SERVICE_AREA" | "CROSS_ZONE";
  message: string;
};

/** Same zone, or adjacent zones within the global bicycle cap (checked separately). */
export function routeZone(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): RouteZoneOk | RouteZoneErr {
  const pickupZones = zonesContaining(pickupLat, pickupLng);
  const dropoffZones = zonesContaining(dropoffLat, dropoffLng);
  if (pickupZones.length === 0 || dropoffZones.length === 0) {
    return {
      ok: false,
      code: "OUTSIDE_SERVICE_AREA",
      message: "This location is outside the KoboRide service area.",
    };
  }

  const shared = pickupZones.filter((pickup) =>
    dropoffZones.some((dropoff) => dropoff.slug === pickup.slug),
  );
  if (shared.length > 0) {
    return { ok: true, zone: nearestZone(pickupLat, pickupLng, shared) };
  }

  const adjacentPickup = pickupZones.find((pickup) =>
    dropoffZones.some((dropoff) => zonesAreAdjacent(pickup, dropoff)),
  );
  if (adjacentPickup) {
    return { ok: true, zone: nearestZone(pickupLat, pickupLng, pickupZones) };
  }

  const from = nearestZone(pickupLat, pickupLng, pickupZones).name;
  const to = nearestZone(dropoffLat, dropoffLng, dropoffZones).name;
  return {
    ok: false,
    code: "CROSS_ZONE",
    message: `KoboRide doesn't deliver between ${from} and ${to}.`,
  };
}

export function isRoutable(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): boolean {
  return routeZone(pickupLat, pickupLng, dropoffLat, dropoffLng).ok;
}

/** Google Places hard-limit: Lagos only, not the rest of Nigeria. */
export function lagosPlacesRestriction() {
  return {
    rectangle: {
      low: { latitude: LAGOS_BOUNDS.south, longitude: LAGOS_BOUNDS.west },
      high: { latitude: LAGOS_BOUNDS.north, longitude: LAGOS_BOUNDS.east },
    },
  };
}
